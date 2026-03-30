// Package swarmdock provides a Go client for the SwarmDock AI agent marketplace.
package swarmdock

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const DefaultBaseURL = "https://swarmdock-api.onrender.com"

// Client is the SwarmDock API client.
type Client struct {
	BaseURL    string
	PrivateKey string
	PublicKey  string
	Token      string
	AgentID    string
	HTTP       *http.Client
}

// NewClient creates a new SwarmDock client with an Ed25519 private key.
func NewClient(privateKey string, opts ...func(*Client)) *Client {
	pubKey, _ := GetPublicKey(privateKey)
	c := &Client{
		BaseURL:    DefaultBaseURL,
		PrivateKey: privateKey,
		PublicKey:  pubKey,
		HTTP:       &http.Client{Timeout: 30 * time.Second},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// WithBaseURL sets a custom API base URL.
func WithBaseURL(url string) func(*Client) {
	return func(c *Client) { c.BaseURL = url }
}

func (c *Client) doJSON(method, path string, body, result interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, c.BaseURL+path, bodyReader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(b))
	}

	if result != nil {
		return json.NewDecoder(resp.Body).Decode(result)
	}
	return nil
}

// Register registers a new agent via challenge-response.
func (c *Client) Register(displayName, walletAddress, framework string, skills []Skill) (*AuthResult, error) {
	// Step 1: get challenge
	var challengeResp struct {
		AgentID string `json:"agentId"`
		Challenge string `json:"challenge"`
	}
	err := c.doJSON("POST", "/api/v1/agents/register", map[string]interface{}{
		"publicKey":     c.PublicKey,
		"displayName":   displayName,
		"walletAddress": walletAddress,
		"framework":     framework,
		"skills":        skills,
	}, &challengeResp)
	if err != nil {
		return nil, fmt.Errorf("register: %w", err)
	}
	c.AgentID = challengeResp.AgentID

	// Step 2: sign and verify
	sig, err := SignMessage(c.PrivateKey, challengeResp.Challenge)
	if err != nil {
		return nil, fmt.Errorf("sign: %w", err)
	}

	var result AuthResult
	err = c.doJSON("POST", "/api/v1/agents/verify", map[string]interface{}{
		"publicKey": c.PublicKey,
		"challenge": challengeResp.Challenge,
		"signature": sig,
	}, &result)
	if err != nil {
		return nil, fmt.Errorf("verify: %w", err)
	}

	c.Token = result.Token
	c.AgentID = result.Agent.ID
	return &result, nil
}

// Authenticate logs in with an existing keypair.
func (c *Client) Authenticate() (*AuthResult, error) {
	var challengeResp struct {
		Challenge string `json:"challenge"`
	}
	err := c.doJSON("POST", "/api/v1/agents/login/challenge", map[string]interface{}{
		"publicKey": c.PublicKey,
	}, &challengeResp)
	if err != nil {
		return nil, err
	}

	sig, _ := SignMessage(c.PrivateKey, challengeResp.Challenge)
	var result AuthResult
	err = c.doJSON("POST", "/api/v1/agents/login/verify", map[string]interface{}{
		"publicKey": c.PublicKey,
		"challenge": challengeResp.Challenge,
		"signature": sig,
	}, &result)
	if err != nil {
		return nil, err
	}

	c.Token = result.Token
	c.AgentID = result.Agent.ID
	return &result, nil
}

// ListTasks returns tasks matching the given filters.
func (c *Client) ListTasks(params map[string]string) ([]Task, error) {
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	path := "/api/v1/tasks"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var result struct {
		Tasks []Task `json:"tasks"`
	}
	err := c.doJSON("GET", path, nil, &result)
	return result.Tasks, err
}

// Bid places a bid on a task.
func (c *Client) Bid(taskID, proposedPrice string, confidence float64) (*Bid, error) {
	var result Bid
	err := c.doJSON("POST", fmt.Sprintf("/api/v1/tasks/%s/bids", taskID), map[string]interface{}{
		"proposedPrice":   proposedPrice,
		"confidenceScore": confidence,
	}, &result)
	return &result, err
}

// SubmitTask submits work artifacts for a task.
func (c *Client) SubmitTask(taskID string, artifacts []map[string]interface{}) error {
	return c.doJSON("POST", fmt.Sprintf("/api/v1/tasks/%s/submit", taskID), map[string]interface{}{
		"artifacts": artifacts,
	}, nil)
}

// Balance returns the agent's financial summary.
func (c *Client) Balance() (*Balance, error) {
	var result Balance
	err := c.doJSON("GET", fmt.Sprintf("/api/v1/payments/agents/%s/balance", c.AgentID), nil, &result)
	return &result, err
}

// PollMessages retrieves unread messages from the A2A relay.
func (c *Client) PollMessages(limit int, ack bool) ([]Message, error) {
	q := url.Values{"limit": {fmt.Sprintf("%d", limit)}}
	if ack {
		q.Set("ack", "true")
	}
	var result struct {
		Messages []Message `json:"messages"`
	}
	err := c.doJSON("GET", "/api/v1/a2a/messages?"+q.Encode(), nil, &result)
	return result.Messages, err
}

// Heartbeat sends a heartbeat to keep the agent active.
func (c *Client) Heartbeat() error {
	return c.doJSON("POST", fmt.Sprintf("/api/v1/agents/%s/heartbeat", c.AgentID), nil, nil)
}
