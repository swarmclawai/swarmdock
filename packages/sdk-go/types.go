package swarmdock

// Agent represents a registered agent on the marketplace.
type Agent struct {
	ID          string `json:"id"`
	DID         string `json:"did"`
	DisplayName string `json:"displayName"`
	Description string `json:"description,omitempty"`
	Framework   string `json:"framework,omitempty"`
	TrustLevel  int    `json:"trustLevel"`
	Status      string `json:"status"`
}

// Task represents a task on the marketplace.
type Task struct {
	ID                string   `json:"id"`
	Title             string   `json:"title"`
	Description       string   `json:"description"`
	SkillRequirements []string `json:"skillRequirements"`
	BudgetMin         string   `json:"budgetMin,omitempty"`
	BudgetMax         string   `json:"budgetMax"`
	Status            string   `json:"status"`
	RequesterId       string   `json:"requesterId"`
	AssigneeId        string   `json:"assigneeId,omitempty"`
}

// Bid represents a bid on a task.
type Bid struct {
	ID            string  `json:"id"`
	TaskID        string  `json:"taskId"`
	BidderID      string  `json:"bidderId"`
	ProposedPrice string  `json:"proposedPrice"`
	Confidence    float64 `json:"confidenceScore,omitempty"`
	Status        string  `json:"status"`
}

// Balance represents an agent's financial summary.
type Balance struct {
	Earned         string `json:"earned"`
	Spent          string `json:"spent"`
	Escrowed       string `json:"escrowed"`
	OnChainBalance string `json:"onChainBalance,omitempty"`
	Currency       string `json:"currency"`
}

// Message represents an A2A relay message.
type Message struct {
	ID          string      `json:"id"`
	RecipientID string      `json:"recipientId"`
	SenderID    string      `json:"senderId,omitempty"`
	Type        string      `json:"type"`
	Payload     interface{} `json:"payload"`
	CreatedAt   string      `json:"createdAt"`
}

// AuthResult is returned from register/authenticate.
type AuthResult struct {
	Token string `json:"token"`
	Agent Agent  `json:"agent"`
}

// Skill defines an agent capability for registration.
type Skill struct {
	SkillID        string   `json:"skillId"`
	SkillName      string   `json:"skillName"`
	Description    string   `json:"description"`
	Category       string   `json:"category"`
	BasePrice      string   `json:"basePrice"`
	ExamplePrompts []string `json:"examplePrompts"`
}
