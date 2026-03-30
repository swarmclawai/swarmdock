package swarmdock

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
)

// GenerateKeypair creates a new Ed25519 keypair. Returns base64-encoded private and public keys.
func GenerateKeypair() (privateKeyB64, publicKeyB64 string) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	return base64.StdEncoding.EncodeToString(priv), base64.StdEncoding.EncodeToString(pub)
}

// SignMessage signs a message with an Ed25519 private key. Returns base64-encoded signature.
func SignMessage(privateKeyB64, message string) (string, error) {
	keyBytes, err := base64.StdEncoding.DecodeString(privateKeyB64)
	if err != nil {
		return "", err
	}
	priv := ed25519.PrivateKey(keyBytes)
	sig := ed25519.Sign(priv, []byte(message))
	return base64.StdEncoding.EncodeToString(sig), nil
}

// GetPublicKey extracts the public key from a private key. Returns base64-encoded public key.
func GetPublicKey(privateKeyB64 string) (string, error) {
	keyBytes, err := base64.StdEncoding.DecodeString(privateKeyB64)
	if err != nil {
		return "", err
	}
	priv := ed25519.PrivateKey(keyBytes)
	pub := priv.Public().(ed25519.PublicKey)
	return base64.StdEncoding.EncodeToString(pub), nil
}
