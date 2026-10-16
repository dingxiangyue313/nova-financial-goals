import { createHash } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { DemoState } from '../shared/contracts.ts';
import { stableHash } from './governance.ts';
import { approveOperation, verifyOperation } from './tools.ts';
import {
  completePasskeyAuthentication, completePasskeyRegistration, getPasskeyCredential,
  getWebAuthnChallenge, saveWebAuthnChallenge,
} from './store.ts';

function config() {
  const rpID = process.env.NOVA_RP_ID || 'localhost';
  const origin = process.env.NOVA_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
  const loopback = rpID === 'localhost' || rpID === '127.0.0.1' || rpID === '[::1]';
  if (process.env.NODE_ENV === 'production' && !loopback && !origin.startsWith('https://')) throw new Error('WEBAUTHN_HTTPS_REQUIRED');
  return { rpID, origin };
}

export function passkeyStatus(sessionId: string) {
  const { rpID } = config();
  return { registered: Boolean(getPasskeyCredential(sessionId)), rpId: rpID, userVerification: 'required' as const };
}

export async function registrationOptions(sessionId: string) {
  const { rpID } = config();
  const existing = getPasskeyCredential(sessionId);
  const options = await generateRegistrationOptions({
    rpName: 'NOVA', rpID, userName: `nova-${createHash('sha256').update(sessionId).digest('hex').slice(0, 12)}`,
    userDisplayName: 'NOVA 演示用户', userID: createHash('sha256').update(sessionId).digest(),
    timeout: 120_000, attestationType: 'none', preferredAuthenticatorType: 'localDevice',
    excludeCredentials: existing ? [{ id: existing.credentialId, transports: existing.transports }] : [],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
  });
  saveWebAuthnChallenge(sessionId, { challenge: options.challenge, kind: 'registration', operationId: null,
    inputHash: null, mandateId: null, twinVersion: null, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), consumedAt: null });
  return { options, challengeId: options.challenge };
}

export async function verifyRegistration(sessionId: string, challengeId: string, response: RegistrationResponseJSON) {
  const binding = getWebAuthnChallenge(sessionId, challengeId);
  if (binding.kind !== 'registration' || binding.consumedAt) throw new Error('WEBAUTHN_CHALLENGE_INVALID');
  const { rpID, origin } = config();
  const result = await verifyRegistrationResponse({ response, expectedChallenge: challengeId,
    expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!result.verified) throw new Error('WEBAUTHN_REGISTRATION_FAILED');
  const { credential } = result.registrationInfo;
  completePasskeyRegistration(sessionId, challengeId, { credentialId: credential.id,
    publicKey: credential.publicKey, counter: credential.counter,
    transports: response.response.transports ?? [] });
  return passkeyStatus(sessionId);
}

export async function authenticationOptions(sessionId: string, operationId: string, state: DemoState) {
  const credential = getPasskeyCredential(sessionId);
  if (!credential) throw new Error('PASSKEY_NOT_REGISTERED');
  const operation = verifyOperation(state, operationId);
  if (operation.status !== 'manual_review' || operation.verificationRequirement !== 'platform')
    throw new Error('USER_VERIFICATION_NOT_REQUIRED');
  if (!state.mandate || operation.mandateId !== state.mandate.id) throw new Error('MANDATE_CHANGED');
  const { rpID } = config();
  const options = await generateAuthenticationOptions({ rpID, timeout: 120_000, userVerification: 'required',
    allowCredentials: [{ id: credential.credentialId, transports: credential.transports }] });
  saveWebAuthnChallenge(sessionId, { challenge: options.challenge, kind: 'authentication', operationId,
    inputHash: operation.inputHash ?? stableHash(operation), mandateId: operation.mandateId ?? null,
    twinVersion: state.twinVersion, expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(), consumedAt: null });
  return { options, challengeId: options.challenge };
}

export async function verifyAuthentication(sessionId: string, challengeId: string, response: AuthenticationResponseJSON) {
  const binding = getWebAuthnChallenge(sessionId, challengeId);
  if (binding.kind !== 'authentication' || binding.consumedAt || !binding.operationId) throw new Error('WEBAUTHN_CHALLENGE_INVALID');
  const credential = getPasskeyCredential(sessionId);
  if (!credential || credential.credentialId !== response.id) throw new Error('WEBAUTHN_CREDENTIAL_MISMATCH');
  const { rpID, origin } = config();
  const result = await verifyAuthenticationResponse({ response, expectedChallenge: challengeId,
    expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    credential: { id: credential.credentialId, publicKey: new Uint8Array(credential.publicKey), counter: credential.counter, transports: credential.transports } });
  if (!result.verified || !result.authenticationInfo.userVerified) throw new Error('WEBAUTHN_AUTHENTICATION_FAILED');
  return completePasskeyAuthentication(sessionId, challengeId, credential.credentialId,
    result.authenticationInfo.newCounter, (state, saved) => {
      const operation = verifyOperation(state, saved.operationId!);
      if (operation.status !== 'manual_review' || operation.inputHash !== saved.inputHash ||
          operation.mandateId !== saved.mandateId || state.twinVersion !== saved.twinVersion)
        throw new Error('WEBAUTHN_BINDING_CHANGED');
      return approveOperation(state, operation.operationId, 'platform');
    });
}
