#!/bin/bash
# Supabase Auth - Examples with curl

# ============================================================================
# REGISTER CUSTOMER (v2)
# ============================================================================

curl -X POST http://localhost:4000/auth/v2/register/customer \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Juan Pérez",
    "email": "juan@example.com",
    "phone": "4491234567",
    "password": "MiPassword123!"
  }'

# Expected response:
# {
#   "userId": "user-uuid",
#   "customerId": 1,
#   "email": "juan@example.com",
#   "message": "Cuenta creada exitosamente..."
# }

# ============================================================================
# REGISTER MECHANIC (v2)
# ============================================================================

curl -X POST http://localhost:4000/auth/v2/register/mechanic \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Carlos López",
    "phone": "4491234568",
    "password": "MiPassword123!",
    "city": "Aguascalientes",
    "zone": "Norte",
    "yearsExperience": 8,
    "specialties": ["Eléctrico", "Motor"]
  }'

# ============================================================================
# LOGIN (v2)
# ============================================================================

curl -X POST http://localhost:4000/auth/v2/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "juan@example.com",
    "password": "MiPassword123!"
  }'

# Expected response:
# {
#   "user": {
#     "id": "user-uuid",
#   "email": "juan@example.com",
#     "role": "customer",
#     "customerId": 1
#   },
#   "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#   "expiresIn": 3600
# }

# Save the accessToken from above, then use it:
TOKEN="your-access-token-here"

# ============================================================================
# GET CURRENT USER (v2)
# ============================================================================

curl -X GET http://localhost:4000/auth/v2/me \
  -H "Authorization: Bearer $TOKEN"

# ============================================================================
# OLD ENDPOINTS (still work)
# ============================================================================

# Register customer (old)
curl -X POST http://localhost:4000/auth/register/customer \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "María García",
    "phone": "4491234569",
    "password": "OldPassword123!"
  }'

# Login (old)
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "login": "4491234569",
    "password": "OldPassword123!"
  }'

# Get me (old)
curl -X GET http://localhost:4000/auth/me \
  -H "Authorization: Bearer your-old-token"
