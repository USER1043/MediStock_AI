import { User } from '../models/userModel.js';
import { generateToken } from '../utils/helpers.js';
import log from '../utils/logger.js';
import { createAuditEntry } from '../middleware/auditLogger.js';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import bcryptjs from 'bcryptjs';
import { getPasswordPolicyFailures, describePasswordPolicyFailures } from '../utils/passwordPolicy.js';

// 400 body for a password that breaks the policy, or null if it's acceptable
const weakPasswordResponse = (password) => {
  const failedRules = getPasswordPolicyFailures(password);
  if (failedRules.length === 0) return null;
  return {
    success: false,
    message: describePasswordPolicyFailures(failedRules),
    errorCode: 'WEAK_PASSWORD',
    failedRules,
  };
};

// Register new user (Owner only - for adding staff)
export const register = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username, email, and password',
      });
    }

    // Only owner can create new users
    if (req.user && req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can register new users',
        errorCode: 'OWNER_ONLY'
      });
    }

    // Validate role
    const allowedRoles = ['owner', 'staff'];
    const userRole = role || 'staff';

    if (!allowedRoles.includes(userRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`,
      });
    }

    const weakPassword = weakPasswordResponse(password);
    if (weakPassword) {
      return res.status(400).json(weakPassword);
    }

    // Check if user already exists
    let user = await User.findOne({ $or: [{ email }, { username }] });
    if (user) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or username already exists',
      });
    }

    // Create user (password will be hashed by pre-save hook)
    user = await User.create({
      username,
      email,
      password,
      role: userRole,
    });

    log('INFO', 'User registered successfully', {
      userId: user._id,
      role: user.role,
      registeredBy: req.user?.id
    });

    res.status(201).json({
      success: true,
      message: `${userRole === 'owner' ? 'Administrator' : 'Staff member'} registered successfully`,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        roleDisplay: user.role === 'owner' ? 'Admin' : 'Operational Staff',
        isActive: user.isActive,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
        createdAt: user.createdAt
      },
    });
  } catch (error) {
    log('ERROR', 'Registration error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: error.message,
    });
  }
};

// Login user
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password',
      });
    }

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check password
    const isPasswordMatch = await user.matchPassword(password);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account is inactive',
      });
    }

    // Check if 2FA is enabled
    if (user.isTwoFactorEnabled) {
      return res.status(200).json({
        success: true,
        requires2FA: true,
        message: '2FA verification required',
        username: user.username
      });
    }

    // Generate token with complete user info
    const token = generateToken(user);

    // ── Explicit audit hook: USER_LOGIN ───────────────────────
    createAuditEntry({
      userId: user._id,
      username: user.username,
      action: 'USER_LOGIN',
      module: 'System',
      details: { role: user.role },
      ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
      httpMethod: 'POST',
      endpoint: '/api/auth/login',
      statusCode: 200,
    }); // fire-and-forget

    log('INFO', 'User logged in successfully', { userId: user._id, role: user.role });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        roleDisplay: user.role === 'owner' ? 'Admin' : 'Operational Staff',
        isActive: user.isActive,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
        permissions: getPermissionsByRole(user.role)
      },
    });
  } catch (error) {
    log('ERROR', 'Login error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error during login',
      error: error.message,
    });
  }
};

// Helper function to get permissions by role
function getPermissionsByRole(role) {
  if (role === 'owner') {
    return {
      canViewFinancials: true,
      canManageUsers: true,
      canApprovePurchaseOrders: true,
      canModifySettings: true,
      canAccessAllModules: true,
      canPerformBilling: true,
      canUploadExcel: true,
      canUseChatbot: true
    };
  }

  // Staff permissions
  return {
    canViewFinancials: false,
    canManageUsers: false,
    canApprovePurchaseOrders: false,
    canModifySettings: false,
    canAccessAllModules: false,
    canPerformBilling: true,
    canUploadExcel: true,
    canUseChatbot: true
  };
}

// Get current user with permissions
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        roleDisplay: user.role === 'owner' ? 'Admin' : 'Operational Staff',
        isActive: user.isActive,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
        createdAt: user.createdAt,
        permissions: getPermissionsByRole(user.role)
      },
    });
  } catch (error) {
    log('ERROR', 'Get current user error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message,
    });
  }
};

// Get all users (Owner only)
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });

    const usersWithDisplayInfo = users.map(user => ({
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      roleDisplay: user.role === 'owner' ? 'Admin' : 'Operational Staff',
      isActive: user.isActive,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));

    res.status(200).json({
      success: true,
      count: users.length,
      users: usersWithDisplayInfo,
    });
  } catch (error) {
    log('ERROR', 'Get all users error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message,
    });
  }
};

// Update user (Owner only, with restrictions)
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, isActive, password } = req.body;

    // Prevent staff from modifying users
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can modify user accounts',
        errorCode: 'OWNER_ONLY'
      });
    }

    // Prevent owner from demoting themselves
    if (id === req.user.id && role && role !== 'owner') {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role',
      });
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Prevent owner from modifying another owner's critical properties (deactivation or demotion)
    if (targetUser.role === 'owner' && id !== req.user.id) {
      if (typeof isActive === 'boolean' || (role && role !== 'owner')) {
        return res.status(403).json({
          success: false,
          message: 'You cannot demote or deactivate another administrator account',
        });
      }
    }

    const updateData = {};
    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;

    // If password is being updated, check the policy on the plain text, then hash it
    if (password) {
      const weakPassword = weakPasswordResponse(password);
      if (weakPassword) {
        return res.status(400).json(weakPassword);
      }
      const salt = await bcryptjs.genSalt(10);
      updateData.password = await bcryptjs.hash(password, salt);
    }

    const user = await User.findByIdAndUpdate(
      id,
      updateData,
      { returnDocument: 'after', runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    log('INFO', 'User updated', {
      updatedUserId: id,
      updatedBy: req.user.id,
      changes: Object.keys(updateData)
    });

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        roleDisplay: user.role === 'owner' ? 'Admin' : 'Operational Staff',
        isActive: user.isActive,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
        updatedAt: user.updatedAt
      },
    });
  } catch (error) {
    log('ERROR', 'Update user error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message,
    });
  }
};

// Delete user (Owner only)
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account',
      });
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent deleting another administrator
    if (targetUser.role === 'owner') {
      return res.status(403).json({
        success: false,
        message: 'You cannot delete another administrator account',
      });
    }

    const user = await User.findByIdAndDelete(id);

    log('INFO', 'User deleted', {
      deletedUserId: id,
      deletedBy: req.user.id,
      deletedUsername: user.username
    });

    res.status(200).json({
      success: true,
      message: `User ${user.username} deleted successfully`,
    });
  } catch (error) {
    log('ERROR', 'Delete user error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error.message,
    });
  }
};

// ============ 2FA CONTROLLERS ============

// Setup 2FA
export const setup2FA = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const secret = speakeasy.generateSecret({
      name: `MediStock AI (${user.email})`,
    });

    // DO NOT overwrite the secret in the database yet. 
    // We send it to frontend, and frontend will return it during verification.

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.status(200).json({
      success: true,
      qrCodeUrl,
      secret: secret.base32
    });
  } catch (error) {
    log('ERROR', 'Setup 2FA error', { error: error.message });
    res.status(500).json({ success: false, message: 'Error setting up 2FA', error: error.message });
  }
};

// Verify 2FA Setup
export const verify2FASetup = async (req, res) => {
  try {
    const { token, secret } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(400).json({ success: false, message: 'User not found' });
    }
    if (!secret) {
      return res.status(400).json({ success: false, message: 'No 2FA secret found to verify' });
    }

    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token,
      window: 1 // Allow 1 step before/after (30 seconds grace period)
    });

    if (verified) {
      user.twoFactorSecret = secret;
      user.isTwoFactorEnabled = true;
      await user.save();

      log('INFO', '2FA enabled successfully', { userId: user._id });
      res.status(200).json({ success: true, message: '2FA successfully enabled' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid 2FA token' });
    }
  } catch (error) {
    log('ERROR', 'Verify 2FA setup error', { error: error.message });
    res.status(500).json({ success: false, message: 'Error verifying 2FA setup', error: error.message });
  }
};

// Verify 2FA Login
export const verify2FALogin = async (req, res) => {
  try {
    const { username, token } = req.body;

    if (!username || !token) {
      return res.status(400).json({ success: false, message: 'Provide username and 2FA token' });
    }

    const user = await User.findOne({ username });
    if (!user || !user.isTwoFactorEnabled) {
      return res.status(400).json({ success: false, message: 'Invalid 2FA request' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (verified) {
      const jwtToken = generateToken(user);

      createAuditEntry({
        userId: user._id,
        username: user.username,
        action: 'USER_LOGIN',
        module: 'System',
        details: { role: user.role, type: '2FA' },
        ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
        httpMethod: 'POST',
        endpoint: '/api/auth/login/verify-2fa',
        statusCode: 200,
      });

      log('INFO', 'User logged in successfully with 2FA', { userId: user._id, role: user.role });

      res.status(200).json({
        success: true,
        message: 'Login successful',
        token: jwtToken,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          roleDisplay: user.role === 'owner' ? 'Admin' : 'Operational Staff',
          isActive: user.isActive,
          isTwoFactorEnabled: user.isTwoFactorEnabled,
          permissions: getPermissionsByRole(user.role)
        }
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid 2FA token' });
    }
  } catch (error) {
    log('ERROR', 'Verify 2FA login error', { error: error.message });
    res.status(500).json({ success: false, message: 'Error verifying 2FA login' });
  }
};
