// encryption.js
// Room-specific substitution cipher.
// The server generates a unique character->code mapping per room and delivers it
// only after password authentication. This module never generates mappings or
// randomness — it only builds lookup tables from the mapping it receives.

let forwardTable = Object.create(null);   // character -> code, e.g. 'a' -> '{P2V7}'
let reverseTable = Object.create(null);   // code       -> character
let mappingLoaded = false;

/**
 * Load the room mapping received from the server.
 * mapping must be a plain object: { "a": "{P2V7}", "b": "{E8R5}", ... }
 */
function setRoomMapping(mapping) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
        throw new Error('setRoomMapping: expected a mapping object from the server.');
    }
    const fwd = Object.create(null);
    const rev = Object.create(null);

    for (const [char, code] of Object.entries(mapping)) {
        if (typeof char !== 'string' || char.length !== 1) {
            throw new Error(`setRoomMapping: invalid character "${char}"`);
        }
        if (typeof code !== 'string' || code.length === 0) {
            throw new Error(`setRoomMapping: invalid code for "${char}"`);
        }
        if (rev[code] !== undefined) {
            throw new Error(`setRoomMapping: duplicate code ${code} — mapping is not unique`);
        }
        fwd[char] = code;
        rev[code] = char;
    }

    forwardTable = fwd;
    reverseTable = rev;
    mappingLoaded = true;
}

function hasMapping() {
    return mappingLoaded;
}

/**
 * Encrypt a message: every mapped character becomes its room-specific code.
 * Characters without a mapping (e.g. space) pass through unchanged.
 */
function encryptMessage(plaintext) {
    if (!mappingLoaded) {
        throw new Error('encryptMessage: no mapping loaded. Call setRoomMapping() first.');
    }
    let out = '';
    for (const char of plaintext) {
        const code = forwardTable[char];
        out += code !== undefined ? code : char;
    }
    return out;
}

/**
 * Decrypt a message: converts the {XXXX} codes back to characters using the
 * reverse table. Anything that is not a code passes through unchanged.
 */
function decryptMessage(ciphertext) {
    if (!mappingLoaded) {
        throw new Error('decryptMessage: no mapping loaded. Call setRoomMapping() first.');
    }
    let out = '';
    let i = 0;
    while (i < ciphertext.length) {
        if (ciphertext[i] === '{' && i + 6 <= ciphertext.length) {
            const token = ciphertext.slice(i, i + 6);
            if (/^\{[A-Z0-9]{4}\}$/.test(token)) {
                const char = reverseTable[token];
                out += char !== undefined ? char : token;
                i += 6;
                continue;
            }
        }
        out += ciphertext[i];
        i += 1;
    }
    return out;
}