//go:build !unix

package provider

import "os"

// Windows has no Unix owner to compare; its temp directory is per user.
func ownedByMe(os.FileInfo) bool { return true }
