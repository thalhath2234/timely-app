# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Scrollers and the keyboard

Give every `ScrollView`, `FlatList` and `SectionList` `keyboardShouldPersistTaps="handled"` (or `"always"`). React Native routes touches through the React tree, so a sheet's `Modal` still sits inside the screen's scroller: one left on the default grabs the first tap while the keyboard is up, and a button in the sheet then needs two taps. `make test-mobile-keyboard-taps` checks this.

# Forms with their own button under the fields

Wrap an inline form whose button sits below its fields (new label, new custom field, "New stage" + "Add stage") in `FocusGroup`, inside a `FocusGroupScrollView` (`components/ui/FocusGroup.tsx`; `BottomSheet` already uses one). While one of its `Field`s has focus the whole form scrolls above the keyboard, and a sheet hides its footer so the form's button is the one on show.
