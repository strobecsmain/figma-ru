// Pack app.asar to an EXACT byte size.
//
// Figma checks the size of app.asar at startup. An archive that is otherwise
// perfectly valid — right contents, right per-file integrity, right header, the
// trailing bytes preserved — will not boot if its total length differs from the
// original by even a few bytes: the app runs main.js, logs its first line and
// exits, with no error anywhere. Verified by appending 64 spaces to an otherwise
// untouched rebuild.
//
// So the patch has a fixed budget. Space is freed by minifying the dictionaries
// Figma ships pretty-printed, and whatever is left over is absorbed by padding a
// designated ballast file back up to the target.
const fs = require('fs');

const asar = require('./asar');

/**
 * Pack `srcDir` so the result is exactly `targetSize` bytes.
 *
 * @param {object} opts
 * @param {object} opts.header    header template (not mutated; cloned per attempt)
 * @param {string} opts.srcDir    extracted tree
 * @param {string} opts.outPath   archive to write
 * @param {Buffer} opts.trailer   trailing bytes from the source archive
 * @param {number} opts.targetSize
 * @param {string} opts.ballastPath  file padded to make up the difference
 * @param {Buffer} opts.ballastBase  that file's real content, without padding
 * @param {string} [opts.pad=' ']    padding byte; must be harmless in the
 *                                   ballast file's format
 * @returns {{padding: number, attempts: number}}
 */
function packToExactSize({
  header,
  srcDir,
  outPath,
  trailer,
  targetSize,
  ballastPath,
  ballastBase,
  pad = ' ',
}) {
  let padding = 0;

  // Padding changes the ballast's `size` field, which can change the header's
  // own length by a digit or two, so the size converges rather than landing in
  // one step.
  for (let attempt = 1; attempt <= 12; attempt++) {
    fs.writeFileSync(
      ballastPath,
      Buffer.concat([ballastBase, Buffer.alloc(padding, pad.charCodeAt(0))])
    );

    // pack() rewrites offsets and integrity into the header it is given.
    const template = JSON.parse(JSON.stringify(header));
    asar.pack(template, srcDir, outPath, trailer);

    const size = fs.statSync(outPath).size;
    if (size === targetSize) return { padding, attempts: attempt };

    if (size > targetSize) {
      if (padding === 0) {
        // Structured so the caller can free more space and retry rather than
        // having to parse a message.
        const err = new Error(
          `patched archive is ${size - targetSize} bytes over the ${targetSize}-byte budget`
        );
        err.code = 'OVER_BUDGET';
        err.excess = size - targetSize;
        throw err;
      }
      // Overshot while converging; step back by the excess.
      padding -= size - targetSize;
      if (padding < 0) padding = 0;
    } else {
      padding += targetSize - size;
    }
  }

  throw new Error('could not converge on the exact archive size');
}

module.exports = { packToExactSize };
