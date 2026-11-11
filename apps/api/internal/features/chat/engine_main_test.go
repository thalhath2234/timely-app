package chat

import (
	"testing"

	"timely-api/internal/agenthost/agenthosttest"
)

// TestMain lets the agent engine's tests run a real agenthost.Supervisor
// against the scriptable fake worker: the supervisor re-executes this test
// binary as the worker (agenthosttest), so no Python is needed.
func TestMain(m *testing.M) { agenthosttest.Main(m) }
