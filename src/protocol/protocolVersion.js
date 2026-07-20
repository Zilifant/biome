/**
 * Version of the renderer-facing simulation protocol. Every message built by
 * the protocol layer carries this number. Bump it on any breaking change to
 * command, snapshot, delta, event, or query shapes.
 */
export const PROTOCOL_VERSION = 25;
