const META_LIST_CHANNEL = 'service:getServiceList';

const asyncChannel = (ns, name) => `${ns}:${name}`;
const syncChannel  = (ns, name) => `${ns}:${name}Sync`;

const okEnvelope    = data  => ({ ok: true,  data });
const errorEnvelope = error => ({ ok: false, error });

module.exports = {
    META_LIST_CHANNEL,
    asyncChannel,
    syncChannel,
    okEnvelope,
    errorEnvelope,
};
