const enumModule = require('./enum');
const utilsModule = require('./utils');
const serializer = require('./serializer');
const { reviveError } = require('./serializer/reviveError');

module.exports = {
    enum: enumModule,
    utils: utilsModule,
    serializer: {
        serialize: serializer.serialize,
        safeStringify: serializer.safeStringify,
        configureSerializer: serializer.configureSerializer,
        reviveError,
    }
};
