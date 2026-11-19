/**
 * @file Schema and model for system User entities.
 * @module models/userModel
 */

import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import {
  PASSWORD_MIN_LENGTH,
  getPasswordPolicyFailures,
  describePasswordPolicyFailures,
} from '../utils/passwordPolicy.js';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    // Stores the bcrypt hash. On save, validation and the policy check below see the
    // plain text; on findByIdAndUpdate (updateUser) the validators see the hash, so
    // the controller checks the policy itself. The custom message keeps the plain
    // password out of the error (Mongoose's default minlength message includes it).
    password: {
      type: String,
      required: true,
      minlength: [PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`],
    },
    role: {
      type: String,
      enum: ['owner', 'staff'],
      default: 'staff',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    twoFactorSecret: {
      type: String,
      default: '',
    },
    isTwoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Hashes user password if it has been modified.
// Mongoose 9 no longer passes `next` to middleware: an async hook signals
// completion by resolving and failure by throwing.
// A new or changed password must meet the policy (utils/passwordPolicy.js). The
// controllers check it first to answer with a 400; this catches every other path
// that saves a User, such as creating the first owner from a script.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const failures = getPasswordPolicyFailures(this.password);
  if (failures.length > 0) {
    const error = new mongoose.Error.ValidationError(this);
    error.addError(
      'password',
      new mongoose.Error.ValidatorError({
        path: 'password',
        type: 'passwordPolicy',
        message: describePasswordPolicyFailures(failures),
      })
    );
    throw error;
  }
  const salt = await bcryptjs.genSalt(10);
  this.password = await bcryptjs.hash(this.password, salt);
});

// Verifies if the entered password matches the stored password.
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcryptjs.compare(enteredPassword, this.password);
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);
