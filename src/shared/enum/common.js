// 代理运行状态
const ProxyStatusEnum = {
    STOPPED: {
        code: 'stopped',
        desc: '服务停止'
    },
    UPGRADING: {
        code: 'upgrading',
        desc: '正在升级'
    },
    RUNNING: {
        code: 'running',
        desc: '正在运行'
    }
};

module.exports = { ProxyStatusEnum };
