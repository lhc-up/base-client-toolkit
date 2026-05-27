function delay(t) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, t);
    })
}

function ping() {
    return 'pong';
}


const schema = {
    namespace: 'example',
    handlers: {
        ping,
        delay,
    },
}

module.exports = {
    schema,
};
