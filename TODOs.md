- [ ] `Notice`中broadcast和direct方法参数支持多个（剩余参数）
- [ ] Notice事件注册设计有问题，现在使用时是调用每个命名空间下的方法名上的on方法，比如:appNotice.example.tick.on(() => {})，
这不符合直觉，应该是:appNotice.example.on('tock', () => {});，整个命名空间有on、once、off等方法，通过map管理事件名下的回调，
需要关注会带来哪些影响？
- [ ] 事件注册时，要校验事件是否是函数
- [ ] 考虑 M3 Notice dispatcher 加 try/catch 隔离 cb 抛错，防止一个 cb 抛错阻断同事件后续订阅者；once 的 wrapper 是"先 unsubscribe 再 cb"，若加 try/catch 需一并考虑是否补发。当前行为在 tests/notice/preload-dispatch.test.js 已标注（'documented'）。改前需更新 spec。
