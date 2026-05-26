const schema = {
  system: {
    events: {
      networkDisconnected: { description: '网络断开', broadcast: true },
      lowBattery: { description: '电量不足', broadcast: true }
    }
  },
  app: {
    events: {
      started: { description: '应用启动', broadcast: true },
      closed: { description: '应用关闭', broadcast: true }
    }
  },
  update: {
    events: {
      progress: { description: '更新进度', broadcast: false },
      completed: { description: '更新完成', broadcast: false },
      error: { description: '更新失败', broadcast: false }
    }
  },
  window: {
    events: {
      maximized: { description: '窗口最大化', broadcast: false },
      minimized: { description: '窗口最小化', broadcast: false },
      closed: { description: '窗口关闭', broadcast: false }
    }
  }
};

module.exports = schema;