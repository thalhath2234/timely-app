// Package migrations embeds the schema migrations so the API binary applies
// them from any working directory. Only the top-level *.sql files are
// embedded; seeds/ is optional mock data applied with goose by hand.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
