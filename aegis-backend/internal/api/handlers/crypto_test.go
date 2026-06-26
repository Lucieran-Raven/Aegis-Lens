package handlers

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/pem"
	"math/big"
	"testing"
)

func TestSignatureVerifier_VerifySignature(t *testing.T) {
	verifier := NewSignatureVerifier()

	// Generate a test key pair
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate private key: %v", err)
	}

	// Export public key to PEM
	pubKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatalf("Failed to marshal public key: %v", err)
	}
	pubKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubKeyBytes,
	})

	tests := []struct {
		name        string
		payload     []byte
		tamper      bool
		wantValid   bool
		wantError   bool
	}{
		{
			name:      "Valid signature",
			payload:   []byte("test payload"),
			tamper:    false,
			wantValid: true,
			wantError: false,
		},
		{
			name:      "Tampered payload - invalid signature",
			payload:   []byte("test payload"),
			tamper:    true,
			wantValid: false,
			wantError: false,
		},
		{
			name:      "Empty payload",
			payload:   []byte(""),
			tamper:    false,
			wantValid: true,
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testPayload := tt.payload
			if tt.tamper {
				testPayload = []byte("tampered payload")
			}

			hashed := sha256.Sum256(testPayload)
			r, s, err := ecdsa.Sign(rand.Reader, privateKey, hashed[:], nil)
			if err != nil {
				t.Fatalf("Failed to sign payload: %v", err)
			}

			// Encode signature to ASN.1
			sig, err := asn1MarshalSignature(r, s)
			if err != nil {
				t.Fatalf("Failed to marshal signature: %v", err)
			}

			valid, err := verifier.VerifySignature(string(pubKeyPEM), sig, tt.payload)

			if tt.wantError && err == nil {
				t.Errorf("VerifySignature() expected error, got nil")
			}
			if !tt.wantError && err != nil {
				t.Errorf("VerifySignature() unexpected error: %v", err)
			}
			if valid != tt.wantValid {
				t.Errorf("VerifySignature() valid = %v, want %v", valid, tt.wantValid)
			}
		})
	}
}

func TestSignatureVerifier_ParsePublicKeyPEM(t *testing.T) {
	verifier := NewSignatureVerifier()

	// Generate a test key pair
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate private key: %v", err)
	}

	// Export public key to PEM
	pubKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatalf("Failed to marshal public key: %v", err)
	}
	validPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubKeyBytes,
	})

	tests := []struct {
		name    string
		pemData string
		wantErr bool
	}{
		{
			name:    "Valid PEM",
			pemData: string(validPEM),
			wantErr: false,
		},
		{
			name:    "Invalid PEM - no block",
			pemData: "not a pem",
			wantErr: true,
		},
		{
			name:    "Empty PEM",
			pemData: "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := verifier.parsePublicKeyPEM(tt.pemData)
			if (err != nil) != tt.wantErr {
				t.Errorf("parsePublicKeyPEM() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSignatureVerifier_ValidateSignatureS(t *testing.T) {
	verifier := NewSignatureVerifier()
	curve := elliptic.P256()

	tests := []struct {
		name string
		s    *big.Int
		want bool
	}{
		{
			name: "S within valid range",
			s:    new(big.Int).Div(curve.Params().N, big.NewInt(4)),
			want: true,
		},
		{
			name: "S at half order",
			s:    new(big.Int).Div(curve.Params().N, big.NewInt(2)),
			want: true,
		},
		{
			name: "S exceeds half order",
			s:    new(big.Int).Div(curve.Params().N, big.NewInt(2)).Add(new(big.Int).Div(curve.Params().N, big.NewInt(2)), big.NewInt(1)),
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := verifier.ValidateSignatureS(tt.s, curve)
			if got != tt.want {
				t.Errorf("ValidateSignatureS() = %v, want %v", got, tt.want)
			}
		})
	}
}

// Helper function to marshal ECDSA signature to ASN.1
func asn1MarshalSignature(r, s *big.Int) ([]byte, error) {
	type ecdsaSignature struct {
		R, S *big.Int
	}
	return asn1.Marshal(ecdsaSignature{R: r, S: s})
}
