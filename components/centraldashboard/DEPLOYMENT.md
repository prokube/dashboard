# Deployment Guide for Role-Based Sidebar Filtering

This guide explains how to deploy the centraldashboard with role-based sidebar link filtering to your Kubeflow cluster.

## Prerequisites

1. Built Docker image with role-based filtering (see build instructions in main README)
2. Access to your Kubernetes cluster
3. kubectl configured to access your cluster
4. Keycloak + Dex + oidc-authservice configured (see ROLE_BASED_FILTERING.md)

## Deployment Options

### Option 1: Using Kustomize (Recommended)

This is the cleanest approach and follows Kubeflow's standard deployment pattern.

**Step 1: Create an overlay directory**

```bash
mkdir -p overlays/role-based-filtering
cd overlays/role-based-filtering
```

**Step 2: Create kustomization.yaml**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: kubeflow

resources:
- ../../base

images:
- name: ghcr.io/kubeflow/dashboard/dashboard
  newName: ghcr.io/prokube/centraldashboard  # Your registry
  newTag: role-based-filtering-v1             # Your tag

patchesStrategicMerge:
- configmap-patch.yaml
```

**Step 3: Create configmap-patch.yaml**

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

**Step 4: Apply with Kustomize**

```bash
kubectl apply -k overlays/role-based-filtering
```

### Option 2: Direct kubectl apply

If you prefer to apply manifests directly:

**Step 1: Update the deployment**

```bash
# Edit the deployment to use your new image
kubectl set image deployment/dashboard \
  dashboard=ghcr.io/prokube/centraldashboard:role-based-filtering-v1 \
  -n kubeflow

# Or edit directly
kubectl edit deployment dashboard -n kubeflow
```

Update the image line:
```yaml
image: ghcr.io/prokube/centraldashboard:role-based-filtering-v1
```

**Step 2: Update the ConfigMap**

```bash
# Edit the ConfigMap to add role requirements
kubectl edit configmap dashboard-config -n kubeflow
```

Add `requiredRoles` to links you want to restrict:
```json
{
  "icon": "settings",
  "link": "/admin/",
  "text": "Admin Panel",
  "type": "item",
  "requiredRoles": ["admin", "cluster-admin"]
}
```

**Step 3: Restart the dashboard**

```bash
kubectl rollout restart deployment/dashboard -n kubeflow
```

### Option 3: Using provided example manifests

```bash
cd components/centraldashboard/manifests/examples

# Update the image in deployment-with-role-filtering.yaml to match your registry
# Then apply:
kubectl apply -f deployment-with-role-filtering.yaml
kubectl apply -f configmap-with-roles.yaml
```

## Verification

### 1. Check Pod Status

```bash
kubectl get pods -n kubeflow -l app=dashboard
kubectl logs -n kubeflow -l app=dashboard --tail=50
```

Look for log messages indicating successful startup.

### 2. Access Debug Endpoint

Port-forward to the dashboard:
```bash
kubectl port-forward -n kubeflow svc/dashboard 8082:80
```

Then access: http://localhost:8082/debug

You should see:
- `authorizationHeader`: "present" or "missing"
- `decodedJWT`: The decoded JWT token with claims
- User roles and groups extracted

### 3. Test Role-Based Filtering

1. Log in as a user with admin role
2. Verify admin-only links are visible
3. Log in as a regular user
4. Verify admin-only links are hidden

## Troubleshooting

### Issue: Authorization header not present

**Symptoms:**
- `/debug` shows `authorizationHeader: "missing"`
- No roles extracted

**Solution:**
Check oidc-authservice configuration to ensure it forwards the Authorization header:

```yaml
# In oidc-authservice ConfigMap or EnvoyFilter
oidc:
  header:
    authorization: "Authorization"
```

### Issue: JWT decoded but no roles

**Symptoms:**
- `/debug` shows decoded JWT
- `roles` and `groups` arrays are empty

**Solution:**
1. Check the JWT claims at https://jwt.io
2. Verify Keycloak includes roles in the token (check client mappers)
3. Verify Dex forwards the claims (check Dex connector config)
4. Check if roles are in a different claim name (update middleware if needed)

### Issue: Links not being filtered

**Symptoms:**
- All links visible regardless of user role
- No errors in logs

**Solution:**
1. Verify ConfigMap has `requiredRoles` on links
2. Check that role names match exactly (case-sensitive)
3. Verify the ConfigMap was reloaded (restart dashboard pod)

### Issue: All links hidden

**Symptoms:**
- No links visible in sidebar
- User has roles but nothing shows

**Solution:**
1. Ensure at least some links have no `requiredRoles` (visible to all)
2. Check role name spelling matches exactly
3. Verify user actually has roles in JWT token

## Rolling Back

If you need to roll back to the previous version:

```bash
# Rollback deployment
kubectl rollout undo deployment/dashboard -n kubeflow

# Or set to previous image
kubectl set image deployment/dashboard \
  dashboard=ghcr.io/kubeflow/dashboard/dashboard:previous-tag \
  -n kubeflow
```

## Configuration Reference

### Environment Variables

The dashboard supports these environment variables:

- `USERID_HEADER`: Header containing user ID (default: `kubeflow-userid`)
- `USERID_PREFIX`: Prefix to strip from user ID (default: empty)
- `PROFILES_KFAM_SERVICE_HOST`: Profile controller service host
- `PROFILES_KFAM_SERVICE_PORT`: Profile controller service port
- `REGISTRATION_FLOW`: Enable registration flow (default: `true`)
- `DASHBOARD_CONFIGMAP`: ConfigMap name for dashboard config
- `LOGOUT_URL`: Logout URL
- `COLLECT_METRICS`: Enable metrics collection

### ConfigMap Schema

Links in the ConfigMap support these fields:

```typescript
interface Link {
  text: string;           // Display text
  link: string;           // URL path
  icon?: string;          // Icon name
  type: "item" | "section";
  requiredRoles?: string[]; // NEW: Roles required to see this link
  items?: Link[];         // For sections
}
```

## Security Considerations

1. **Server-Side Filtering**: Links are filtered server-side, so users cannot bypass by calling the API directly
2. **Token Verification**: Token signature is verified by oidc-authservice before reaching the dashboard
3. **Defense in Depth**: Ensure iframed applications also validate user permissions
4. **Audit Logging**: Consider enabling audit logs to track who accesses what

## Next Steps

1. Configure Keycloak to include roles in JWT tokens
2. Update Dex to forward role claims
3. Ensure oidc-authservice forwards Authorization header
4. Add `requiredRoles` to sensitive links in ConfigMap
5. Test with users having different roles
6. Monitor logs for any issues

For more details, see:
- [ROLE_BASED_FILTERING.md](ROLE_BASED_FILTERING.md) - Complete feature documentation
- [README.md](README.md) - General dashboard documentation
