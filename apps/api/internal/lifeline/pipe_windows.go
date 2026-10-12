package lifeline

// Windows has no SIGPIPE; a write to a closed pipe already returns an error.
func ignoreBrokenPipe() {}
