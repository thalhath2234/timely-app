package main

import (
	"testing"

	"timely-api/internal/agenthost/agenthosttest"
)

// The chat tests run turns on the agent engine with the fake worker, which
// is this test binary started again (agenthosttest.Main).
func TestMain(m *testing.M) { agenthosttest.Main(m) }
