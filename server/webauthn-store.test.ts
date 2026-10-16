import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  completePasskeyAuthentication, completePasskeyRegistration, getPasskeyCredential,
  getWebAuthnChallenge, saveWebAuthnChallenge,
} from './store.ts';

function registration(sessionId: string, challenge: string, expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  saveWebAuthnChallenge(sessionId, { challenge, kind: 'registration', operationId: null, inputHash: null,
    mandateId: null, twinVersion: null, expiresAt, consumedAt: null });
}

test('passkey challenges are single-use, expire, and remain isolated by session', () => {
  const session = randomUUID();
  const other = randomUUID();
  const challenge = `register-${randomUUID()}`;
  registration(session, challenge);
  assert.throws(() => getWebAuthnChallenge(other, challenge), /WEBAUTHN_CHALLENGE_NOT_FOUND/);
  completePasskeyRegistration(session, challenge, { credentialId: `cred-${randomUUID()}`,
    publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] });
  assert.equal(getPasskeyCredential(session)?.transports[0], 'internal');
  assert.throws(() => completePasskeyRegistration(session, challenge, { credentialId: 'second',
    publicKey: new Uint8Array([4]), counter: 0, transports: [] }), /WEBAUTHN_CHALLENGE_REPLAYED/);

  const expired = `expired-${randomUUID()}`;
  registration(session, expired, new Date(Date.now() - 1_000).toISOString());
  assert.throws(() => completePasskeyRegistration(session, expired, { credentialId: 'expired',
    publicKey: new Uint8Array([5]), counter: 0, transports: [] }), /WEBAUTHN_CHALLENGE_EXPIRED/);
});

test('authentication consumes its challenge and counter atomically with the state write', () => {
  const session = randomUUID();
  const registerChallenge = `register-${randomUUID()}`;
  const credentialId = `cred-${randomUUID()}`;
  registration(session, registerChallenge);
  completePasskeyRegistration(session, registerChallenge, { credentialId,
    publicKey: new Uint8Array([9, 8, 7]), counter: 0, transports: ['internal'] });
  const authChallenge = `auth-${randomUUID()}`;
  saveWebAuthnChallenge(session, { challenge: authChallenge, kind: 'authentication', operationId: 'operation-1',
    inputHash: 'hash', mandateId: 'mandate', twinVersion: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(), consumedAt: null });
  completePasskeyAuthentication(session, authChallenge, credentialId, 1, state => state);
  assert.equal(getPasskeyCredential(session)?.counter, 1);
  assert.throws(() => completePasskeyAuthentication(session, authChallenge, credentialId, 2, state => state),
    /WEBAUTHN_CHALLENGE_REPLAYED/);
});
