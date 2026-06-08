const EVENT_CHANNEL = 'notice:event';
const META_GET_SCHEMA_CHANNEL = 'notice:getSchema';

const okEnvelope    = data  => ({ ok: true,  data });
const errorEnvelope = error => ({ ok: false, error });

module.exports = {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
    okEnvelope,
    errorEnvelope,
};
