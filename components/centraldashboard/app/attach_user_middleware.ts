import {NextFunction, Request, RequestHandler, Response} from 'express';

/**
 * Decodes a JWT token without verification (for extracting claims).
 * Note: This does NOT verify the token signature. Token verification
 * should be done by the authentication proxy (oidc-authservice).
 */
function decodeJWT(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString()
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (err) {
    console.warn('Failed to decode JWT token:', err.message);
    return null;
  }
}

/**
 * Extracts roles and groups from JWT token claims.
 * Supports multiple claim formats:
 * - groups: string[] (standard OIDC claim)
 * - roles: string[]
 * - realm_access.roles: string[] (Keycloak format)
 * - resource_access.<client>.roles: string[] (Keycloak client roles)
 */
function extractRolesAndGroups(decodedToken: any): {roles: string[], groups: string[]} {
  const roles: string[] = [];
  const groups: string[] = [];

  if (!decodedToken) {
    return {roles, groups};
  }

  if (Array.isArray(decodedToken.groups)) {
    groups.push(...decodedToken.groups);
  }

  if (Array.isArray(decodedToken.roles)) {
    roles.push(...decodedToken.roles);
  }

  if (decodedToken.realm_access && Array.isArray(decodedToken.realm_access.roles)) {
    roles.push(...decodedToken.realm_access.roles);
  }

  if (decodedToken.resource_access) {
    Object.keys(decodedToken.resource_access).forEach(client => {
      if (Array.isArray(decodedToken.resource_access[client].roles)) {
        roles.push(...decodedToken.resource_access[client].roles);
      }
    });
  }

  return {
    roles: [...new Set(roles)],
    groups: [...new Set(groups)],
  };
}

/**
 * Returns a function that uses the provided header and prefix to extract
 * a User object with the requesting user's identity.
 * Also extracts roles and groups from JWT token if available.
 */
export function attachUser(
    userIdHeader: string, userIdPrefix: string): RequestHandler {
  return (req: Request, _: Response, next: NextFunction) => {
    let email = 'anonymous@kubeflow.org';
    let auth: User.AuthObject;
    let roles: string[] = [];
    let groups: string[] = [];

    if (userIdHeader && req.header(userIdHeader)) {
      email = req.header(userIdHeader).slice(userIdPrefix.length);
      auth = {[userIdHeader]: req.header(userIdHeader)};
    }

    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decodedToken = decodeJWT(token);
      const extracted = extractRolesAndGroups(decodedToken);
      roles = extracted.roles;
      groups = extracted.groups;
    }

    req.user = {
      email,
      username: email.split('@')[0],
      domain: email.split('@')[1],
      hasAuth: auth !== undefined,
      auth,
      roles,
      groups,
    };
    next();
  };
}
