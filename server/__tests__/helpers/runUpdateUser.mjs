/**
 * Runs the real updateUser controller under plain Node (not Jest's module loader)
 * and prints `{ statusCode, body }` as JSON.
 *
 * Why a child process: Jest's ESM loader exposes every key of a CommonJS module as
 * a named export, but Node only exposes what its static analysis finds. For
 * bcryptjs 2.4.3 (a UMD bundle) Node finds nothing, so
 * `(await import('bcryptjs')).genSalt` is undefined in production yet defined
 * under Jest. Only a plain-Node run reproduces that.
 *
 * Usage: node runUpdateUser.mjs <mongoUri> '<json { params, body, user }>'
 */

import { registerHooks } from 'node:module';

// Swap the file logger for a no-op so the run leaves no log files behind
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/utils/logger.js')) {
      return { url: 'data:text/javascript,export default () => {};', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const [uri, reqJson] = process.argv.slice(2);
const { params, body, user } = JSON.parse(reqJson);

const { default: mongoose } = await import('mongoose');
const { updateUser } = await import('../../controllers/authController.js');

await mongoose.connect(uri);
try {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  await updateUser({ params, body, user, headers: {} }, res);
  process.stdout.write(JSON.stringify({ statusCode: res.statusCode, body: res.body }));
} finally {
  await mongoose.disconnect();
}
