const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { expandKey, cryptBlock } = require('./block');

const BLOCK_SIZE = 16;

function asBytes(value, label) {
    const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value || []);
    if (bytes.length !== BLOCK_SIZE) throw new TypeError(`${label} must be 16 bytes`);
    return bytes;
}

function normalizeAlgorithm(algorithm) {
    if (String(algorithm).toUpperCase() !== 'SM4-CBC') throw new TypeError('Unsupported SM4 algorithm');
}

function applyPadding(data) {
    const size = BLOCK_SIZE - (data.length % BLOCK_SIZE || 0);
    return Buffer.concat([data, Buffer.alloc(size, size)]);
}

function removePadding(data) {
    if (data.length === 0 || data.length % BLOCK_SIZE !== 0) throw new Error('Invalid PKCS#7 padding');
    const size = data[data.length - 1];
    if (size < 1 || size > BLOCK_SIZE) throw new Error('Invalid PKCS#7 padding');
    for (let i = data.length - size; i < data.length; i += 1) {
        if (data[i] !== size) throw new Error('Invalid PKCS#7 padding');
    }
    return data.subarray(0, data.length - size);
}

class SM4Cipher extends Transform {
    constructor(decrypt, key, iv) {
        super();
        this.decrypting = decrypt;
        this.roundKeys = expandKey(asBytes(key, 'key'));
        this.previous = asBytes(iv, 'iv');
        this.pending = Buffer.alloc(0);
        this.autoPadding = true;
        this.finalized = false;
    }

    setAutoPadding(enabled = true) {
        this.autoPadding = Boolean(enabled);
        return this;
    }

    _cryptBlock(block) {
        if (this.decrypting) {
            const plain = Buffer.alloc(BLOCK_SIZE);
            const decrypted = cryptBlock(block, this.roundKeys.slice().reverse());
            for (let i = 0; i < BLOCK_SIZE; i += 1) plain[i] = decrypted[i] ^ this.previous[i];
            this.previous = Buffer.from(block);
            return plain;
        }
        const input = Buffer.alloc(BLOCK_SIZE);
        for (let i = 0; i < BLOCK_SIZE; i += 1) input[i] = block[i] ^ this.previous[i];
        const encrypted = cryptBlock(input, this.roundKeys);
        this.previous = Buffer.from(encrypted);
        return encrypted;
    }

    _consume(data, keepLast = false) {
        this.pending = Buffer.concat([this.pending, data]);
        const limit = keepLast ? Math.max(0, this.pending.length - BLOCK_SIZE) : this.pending.length;
        const count = Math.floor(limit / BLOCK_SIZE) * BLOCK_SIZE;
        const output = [];
        for (let offset = 0; offset < count; offset += BLOCK_SIZE) {
            output.push(this._cryptBlock(this.pending.subarray(offset, offset + BLOCK_SIZE)));
        }
        this.pending = this.pending.subarray(count);
        return Buffer.concat(output);
    }

    update(data, inputEncoding, outputEncoding) {
        if (this.finalized) throw new Error('Cipher is finalized');
        const input = typeof data === 'string' ? Buffer.from(data, inputEncoding) : Buffer.from(data);
        const result = this._consume(input, this.decrypting);
        return outputEncoding ? result.toString(outputEncoding) : result;
    }

    final(outputEncoding) {
        if (this.finalized) throw new Error('Cipher is finalized');
        this.finalized = true;
        let result;
        if (this.decrypting) {
            if (this.pending.length !== BLOCK_SIZE) throw new Error('Invalid ciphertext length');
            result = this.autoPadding ? removePadding(this._cryptBlock(this.pending)) : this._cryptBlock(this.pending);
            this.pending = Buffer.alloc(0);
        } else {
            if (!this.autoPadding && this.pending.length !== 0) throw new Error('Data is not block aligned');
            const pending = this.pending;
            this.pending = Buffer.alloc(0);
            const padded = this.autoPadding ? applyPadding(pending) : pending;
            result = padded.length ? this._consume(padded, false) : Buffer.alloc(0);
            this.pending = Buffer.alloc(0);
        }
        return outputEncoding ? result.toString(outputEncoding) : result;
    }

    _transform(chunk, encoding, callback) {
        setImmediate(() => {
            try {
                const output = this.update(chunk, encoding);
                if (output.length) this.push(output);
                callback();
            } catch (error) {
                callback(error);
            }
        });
    }

    _flush(callback) {
        setImmediate(() => {
            try {
                const output = this.final();
                if (output.length) this.push(output);
                callback();
            } catch (error) {
                callback(error);
            }
        });
    }
}

function createCipheriv(algorithm, key, iv) {
    normalizeAlgorithm(algorithm);
    return new SM4Cipher(false, key, iv);
}

function createDecipheriv(algorithm, key, iv) {
    normalizeAlgorithm(algorithm);
    return new SM4Cipher(true, key, iv);
}

async function collect(readable) {
    const chunks = [];
    for await (const chunk of readable) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function encrypt(data, { key, iv }) {
    const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const source = require('node:stream').Readable.from([input]);
    return collect(source.pipe(createCipheriv('SM4-CBC', key, iv)));
}

async function decrypt(data, { key, iv }) {
    const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const source = require('node:stream').Readable.from([input]);
    return collect(source.pipe(createDecipheriv('SM4-CBC', key, iv)));
}

async function encryptPipeline(readable, writable, { key, iv }) {
    return pipeline(readable, createCipheriv('SM4-CBC', key, iv), writable);
}

async function decryptPipeline(readable, writable, { key, iv }) {
    return pipeline(readable, createDecipheriv('SM4-CBC', key, iv), writable);
}

module.exports = {
    createCipheriv,
    createDecipheriv,
    encrypt,
    decrypt,
    encryptPipeline,
    decryptPipeline,
};
