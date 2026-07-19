/**
 * Domain event type names.
 *
 * Single-sourced from the protocol package: event names are part of the
 * public contract, and the dependency arrow is simulation → protocol only
 * (the protocol never imports simulation code).
 */
export { EventTypes } from '../../protocol/events.js';
