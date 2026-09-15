/**
 * Explicit main-process entry point.
 *
 * Runtime capabilities and main-only utilities are exposed from subpaths as
 * the directory migration proceeds. This entry intentionally has no root
 * aggregate side effects.
 */
module.exports = {
    capability: require('./capability'),
    BaseWindow: require('./enhance/BaseWindow'),
    paths: require('./paths'),
};
