const schema = [
    {
        namespace: 'system',
        handlers: ['getVersion', 'getServiceList']
    },
    {
        namespace: 'app',
        handlers: ['restartApp', 'quitApp', 'minimizeApp']
    },
    {
        namespace: 'store',
        handlers: ['set', 'get', 'remove']
    }
];

module.exports = schema;
