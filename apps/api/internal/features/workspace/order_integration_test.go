package workspace

import (
	"reflect"
	"testing"

	"timely-api/internal/models"
)

// Saving a status, label or custom field without a change used to move it to
// the bottom of its list: the lists were read with no ORDER BY, and Postgres
// returns an updated row after the others.
func TestIntegrationWorkspaceItemsKeepOrderAfterSave(t *testing.T) {
	f := newFixture(t)

	for _, name := range []string{"Urgent", "Later"} {
		_, err := f.svc.CreateLabels(f.owner, &models.Lable{Name: name, Color: "#333333", WorkspaceID: f.ws})
		must(t, err)
	}
	for _, name := range []string{"Owner", "Cost"} {
		_, err := f.svc.CreateCustomFields(f.owner, &models.CustomField{Name: name, Type: models.CustomFieldTypeText, WorkspaceID: f.ws})
		must(t, err)
	}

	wantStatuses := []string{"Backlog", "Todo", "In Progress", "Blocked", "Completed", "Canceled", "Review"}
	wantLabels := []string{"Bug", "Urgent", "Later"}
	wantFields := []string{"Estimate", "Owner", "Cost"}

	check := func(when string) {
		t.Helper()
		byID, err := f.svc.GetWorkspaceById(f.owner, f.ws)
		must(t, err)
		all, err := f.svc.GetAllWorkspaceByUser(f.owner)
		must(t, err)
		if len(all) != 1 {
			t.Fatalf("%s: want 1 workspace, got %d", when, len(all))
		}
		for source, ws := range map[string]*models.Workspace{"GetWorkspaceById": byID, "GetAllWorkspaceByUser": &all[0]} {
			var statuses, labels, fields []string
			for _, s := range ws.Status {
				statuses = append(statuses, s.Name)
			}
			for _, l := range ws.Lables {
				labels = append(labels, l.Name)
			}
			for _, c := range ws.CustomFields {
				fields = append(fields, c.Name)
			}
			if !reflect.DeepEqual(statuses, wantStatuses) {
				t.Errorf("%s %s statuses = %v, want %v", when, source, statuses, wantStatuses)
			}
			if !reflect.DeepEqual(labels, wantLabels) {
				t.Errorf("%s %s labels = %v, want %v", when, source, labels, wantLabels)
			}
			if !reflect.DeepEqual(fields, wantFields) {
				t.Errorf("%s %s custom fields = %v, want %v", when, source, fields, wantFields)
			}
		}
		custom, err := NewWorkspaceRepository(f.db).GetAllCustomFields(f.owner)
		must(t, err)
		var names []string
		for _, c := range custom {
			names = append(names, c.Name)
		}
		if !reflect.DeepEqual(names, wantFields) {
			t.Errorf("%s GetAllCustomFields = %v, want %v", when, names, wantFields)
		}
	}
	check("before save")

	ws, err := f.svc.GetWorkspaceById(f.owner, f.ws)
	must(t, err)
	// Save the first item of each list with no change, as the editors do.
	for _, s := range ws.Status {
		if s.Name == "Blocked" || s.Name == "Backlog" {
			_, err := f.svc.UpdateStatuses(f.owner, &models.Status{ID: s.ID, Name: s.Name, Color: s.Color, WorkspaceID: f.ws})
			must(t, err)
		}
	}
	first := ws.Lables[0]
	_, err = f.svc.UpdateLabels(f.owner, &models.Lable{ID: first.ID, Name: first.Name, Color: first.Color, WorkspaceID: f.ws})
	must(t, err)
	field := ws.CustomFields[0]
	_, err = f.svc.UpdateCustomFields(f.owner, &models.CustomField{ID: field.ID, Name: field.Name, Type: field.Type, Options: field.Options, WorkspaceID: f.ws})
	must(t, err)

	check("after save")
}
