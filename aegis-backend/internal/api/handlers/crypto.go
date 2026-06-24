package handlers

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
)

// ECDSASignature represents the ASN.1 structure of an ECDSA signature
type ECDSASignature struct {
	R *big.Int
	S *big.Int
}

// SignatureVerifier handles ECDSA P-256 signature verification
type SignatureVerifier struct{}

// NewSignatureVerifier creates a new signature verifier
func NewSignatureVerifier() *SignatureVerifier {
	return &SignatureVerifier{}
}

// VerifySignature validates an ECDSA P-256 signature
// CRITICAL FIX: Enforces low-S signature normalization to prevent signature malleability attacks (C5)
func (v *SignatureVerifier) VerifySignature(
	publicKeyPEM string,
	signature []byte,
	payload []byte,
) (bool, error) {
	// Parse public key from PEM
	publicKey, err := v.parsePublicKeyPEM(publicKeyPEM)
	if err != nil {
		return false, fmt.Errorf("failed to parse public key: %w", err)
	}

	// Verify the public key is P-256
	if publicKey.Curve != elliptic.P256() {
		return false, errors.New("public key is not P-256")
	}

	// Parse ASN.1 signature
	sig, err := v.parseASN1Signature(signature)
	if err != nil {
		return false, fmt.Errorf("failed to parse signature: %w", err)
	}

	// CRITICAL: Normalize signature to low-S form to prevent malleability
	// This ensures that for any valid signature (r, s), we only accept the version where s <= n/2
	// Without this, an attacker could replay a signature with s' = n - s, which is also valid
	sig = v.NormalizeSignature(sig, publicKey.Curve)

	// Hash the payload
	hashed := sha256.Sum256(payload)

	// Verify signature with normalized low-S value
	valid := ecdsa.Verify(publicKey, hashed[:], sig.R, sig.S)

	return valid, nil
}

// parsePublicKeyPEM parses a PEM-encoded public key
func (v *SignatureVerifier) parsePublicKeyPEM(pemData string) (*ecdsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(pemData))
	if block == nil {
		return nil, errors.New("failed to decode PEM block")
	}

	// Try PKIX format first
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err == nil {
		ecdsaPub, ok := pub.(*ecdsa.PublicKey)
		if !ok {
			return nil, errors.New("not an ECDSA public key")
		}
		return ecdsaPub, nil
	}

	// Try PKCS8 format
	pub, err = x509.ParsePKCS8PublicKey(block.Bytes)
	if err == nil {
		ecdsaPub, ok := pub.(*ecdsa.PublicKey)
		if !ok {
			return nil, errors.New("not an ECDSA public key")
		}
		return ecdsaPub, nil
	}

	return nil, fmt.Errorf("failed to parse public key: %w", err)
}

// parseASN1Signature parses an ASN.1 encoded ECDSA signature
func (v *SignatureVerifier) parseASN1Signature(signature []byte) (*ECDSASignature, error) {
	var sig ECDSASignature
	_, err := asn1.Unmarshal(signature, &sig)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal ASN.1 signature: %w", err)
	}

	// Validate R and S are positive
	if sig.R == nil || sig.S == nil {
		return nil, errors.New("invalid signature: R or S is nil")
	}

	if sig.R.Sign() <= 0 || sig.S.Sign() <= 0 {
		return nil, errors.New("invalid signature: R or S is not positive")
	}

	return &sig, nil
}

// ParseBase64Signature decodes a base64-encoded signature
func (v *SignatureVerifier) ParseBase64Signature(base64Sig string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(base64Sig)
}

// HashPayload hashes the payload using SHA-256
func (v *SignatureVerifier) HashPayload(payload []byte) []byte {
	hashed := sha256.Sum256(payload)
	return hashed[:]
}

// GetPublicKeyFingerprint returns a fingerprint of the public key
func (v *SignatureVerifier) GetPublicKeyFingerprint(publicKeyPEM string) (string, error) {
	publicKey, err := v.parsePublicKeyPEM(publicKeyPEM)
	if err != nil {
		return "", err
	}

	// Serialize the public key
	pubBytes := elliptic.Marshal(publicKey.Curve, publicKey.X, publicKey.Y)

	// Hash the serialized bytes
	hashed := sha256.Sum256(pubBytes)

	return fmt.Sprintf("%x", hashed)[:16], nil
}

// ValidateSignatureS checks if the S value is within the acceptable range
// (low-S value to prevent signature malleability)
func (v *SignatureVerifier) ValidateSignatureS(s *big.Int, curve elliptic.Curve) bool {
	halfOrder := new(big.Int).Div(curve.Params().N, big.NewInt(2))
	return s.Cmp(halfOrder) <= 0
}

// NormalizeSignature converts a signature to low-S form
func (v *SignatureVerifier) NormalizeSignature(sig *ECDSASignature, curve elliptic.Curve) *ECDSASignature {
	if sig.S.Cmp(new(big.Int).Div(curve.Params().N, big.NewInt(2))) > 0 {
		sig.S.Sub(curve.Params().N, sig.S)
	}
	return sig
}
