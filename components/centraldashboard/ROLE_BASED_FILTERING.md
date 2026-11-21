# Role-Based Sidebar Link Filtering

This document describes how to configure role-based filtering for sidebar links in the Kubeflow Dashboard.

## Overview

The dashboard now supports conditionally showing sidebar links based on user roles or groups from OIDC authentication. This allows administrators to control which links are visible to different users based on their permissions.

## How It Works

1. **Authentication Flow**: User authenticates via OIDC provider (e.g., Keycloak) → Dex → oidc-authservice
2. **Token Forwarding**: oidc-authservice forwards the JWT token in the `Authorization: Bearer <token>` header
3. **Role Extraction**: Dashboard middleware decodes the JWT and extracts roles/groups from claims
4. **Link Filtering**: Dashboard API filters links based on `requiredRoles` configuration

## Supported JWT Claim Formats

The middleware automatically extracts roles and groups from multiple JWT claim formats:

- `groups`: Standard OIDC groups claim (array of strings)
- `roles`: Custom roles claim (array of strings)
- `realm_access.roles`: Keycloak realm roles (array of strings)
- `resource_access.<client>.roles`: Keycloak client-specific roles (array of strings)

## Configuration

### 1. Configure OIDC Provider (Keycloak)

Add a client mapper to include roles in the ID token:

**Mapper Configuration:**
- Mapper Type: "User Realm Role" or "User Client Role"
- Token Claim Name: `groups` (or `roles`)
- Add to ID token: YES
- Add to access token: YES

### 2. Configure Dex

Update your Dex connector configuration to request and forward groups:

```yaml
connectors:
- type: oidc
  id: keycloak
  name: Keycloak
  config:
    issuer: https://keycloak.example.com/realms/your-realm
    clientID: dex
    clientSecret: xxx
    redirectURI: https://dex.example.com/callback
    scopes:
      - openid
      - profile
      - email
      - groups  # Request groups claim
    getUserInfo: true
    claimMapping:
      groups: groups  # Map Keycloak groups to Dex groups
```

### 3. Configure oidc-authservice

Ensure oidc-authservice forwards the Authorization header to upstream services:

```yaml
oidc:
  # ... other config ...
  header:
    authorization: "Authorization"  # Forward the token
```

### 4. Configure Dashboard Links

Add `requiredRoles` to links in the ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: dashboard-config
  namespace: kubeflow
data:
  links: |-
    {
      "menuLinks": [
        {
          "icon": "book",
          "link": "/jupyter/",
          "text": "Notebooks",
          "type": "item"
        },
        {
          "icon": "settings",
          "link": "/admin/",
          "text": "Admin Panel",
          "type": "item",
          "requiredRoles": ["admin", "cluster-admin"]
        }
      ]
    }
```

## Link Configuration Schema

### Basic Link (No Role Requirement)

```json
{
  "icon": "book",
  "link": "/jupyter/",
  "text": "Notebooks",
  "type": "item"
}
```

This link is visible to all users.

### Link with Role Requirement

```json
{
  "icon": "settings",
  "link": "/admin/",
  "text": "Admin Panel",
  "type": "item",
  "requiredRoles": ["admin", "cluster-admin"]
}
```

This link is only visible to users with the `admin` OR `cluster-admin` role/group.

### Section with Role Requirements

```json
{
  "icon": "kubeflow:pipeline-centered",
  "text": "Pipelines",
  "type": "section",
  "items": [
    {
      "link": "/pipeline/#/pipelines",
      "text": "Pipelines",
      "type": "item"
    },
    {
      "link": "/pipeline/#/admin",
      "text": "Pipeline Admin",
      "type": "item",
      "requiredRoles": ["pipeline-admin"]
    }
  ]
}
```

Individual items within a section can have role requirements. If all items in a section are filtered out, the section itself is hidden.

## Testing and Debugging

### Debug Endpoint

Access `/debug` endpoint to inspect authentication information:

```bash
curl https://your-kubeflow-domain/debug
```

This returns:
- Current user information
- All HTTP headers
- Decoded JWT token (if present)
- Extracted roles and groups

### Verify JWT Token

1. Access the dashboard while logged in
2. Open browser developer tools → Network tab
3. Find a request to the dashboard
4. Check if `Authorization: Bearer <token>` header is present
5. Copy the token and decode it at https://jwt.io to verify claims

### Common Issues

**Issue: Links not being filtered**
- Check if Authorization header reaches the dashboard (`/debug` endpoint)
- Verify JWT contains role/group claims
- Check claim name matches expected format

**Issue: All links hidden**
- Verify user has at least one role/group
- Check role names match exactly (case-sensitive)
- Ensure at least some links have no `requiredRoles` (visible to all)

**Issue: JWT not forwarded**
- Check oidc-authservice configuration
- Verify Istio/Envoy configuration allows Authorization header

## Security Considerations

1. **Server-Side Filtering**: Links are filtered server-side in `/api/dashboard-links` - users cannot bypass by calling the API directly
2. **Token Verification**: Token signature verification is handled by oidc-authservice before requests reach the dashboard
3. **Defense in Depth**: Hiding links is not a security boundary - ensure iframed applications also validate user permissions
4. **Role Validation**: The middleware extracts roles from the JWT but does not verify the token signature (this is oidc-authservice's responsibility)

## Example Configurations

See `manifests/examples/configmap-with-roles.yaml` for a complete example with role-based filtering.

## Migration Guide

To add role-based filtering to an existing deployment:

1. Update the dashboard deployment to use the new image with role-based filtering support
2. Configure your OIDC provider to include roles in JWT tokens
3. Update Dex configuration to forward role claims
4. Ensure oidc-authservice forwards Authorization header
5. Add `requiredRoles` to links in your ConfigMap
6. Test with users having different roles

## Backward Compatibility

- Links without `requiredRoles` are visible to all users (existing behavior)
- If no Authorization header is present, all links without `requiredRoles` are shown
- Existing deployments continue to work without changes
