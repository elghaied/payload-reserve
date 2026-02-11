Plan: CalendarView UX Improvements for Admin Reservation Management                                                                                                                                                                                                                                                                                                                                                                                 Context                                                                                                                                                                                                                                                                                                                                                                                                                                             The admin panel's CalendarView is the primary interface for staff managing reservations. Several UX gaps make daily operations harder than they need to be:                                                                                                                                                                                                                                                                                         1. Walk-in problem: When a customer shows up in person, staff create a reservation that's already confirmed — but the hook forces pending status on all creates, requiring a second step to confirm                      
 2. No click-to-create: Staff can't click a date/time cell to create a reservation for that slot — they have to use the generic "Create New" button and manually pick the date
 3. Sparse event display: Calendar events only show time + service name — no customer name, no resource, no tooltip with details
 4. No status legend: Color-coded events have no key explaining what each color means
 5. No current time indicator: In week/day views there's no visual marker for "right now"

 Changes

 1. Allow admin users to create reservations as "confirmed"

 File: src/hooks/reservations/validateStatusTransition.ts

 - Add req to the destructured hook arguments
 - In the create branch: if req.user exists (authenticated admin), allow both 'pending' and 'confirmed'; if no user (public API), only allow 'pending'
 - Update the error message to reflect the allowed statuses dynamically

 2. Click calendar cells to create reservation for that date/time

 File: src/components/CalendarView/index.tsx

 - Add initialData state (Record<string, unknown> | undefined) to pre-fill the drawer's startTime field
 - Add handleDateClick(date: Date) callback — sets drawerDocId to null, sets initialData to { startTime: date.toISOString() }, calls openDrawer()
 - Update handleCreateNew and handleEventClick to clear initialData appropriately
 - Pass initialData prop to <DocumentDrawer> (confirmed supported via DocumentDrawerProps.initialData?: Data)
 - Make month view day cells clickable (default to 9:00 AM for the clicked date)
 - Make week/day view time cells clickable (use the cell's specific hour)
 - Add e.stopPropagation() on event item clicks to prevent triggering cell click

 File: src/components/CalendarView/CalendarView.module.css

 - Add cursor: pointer and hover background to .dayCell, .weekCell, .dayViewCell

 3. Enhanced event display with tooltips

 File: src/components/CalendarView/index.tsx

 - Update getEventLabel to accept a compact flag — compact (month view) shows time + service; full (week/day views) shows time + service + customer name
 - Add getEventTooltip(r) function returning a multi-line native title attribute string with: service, time range, customer, resource, status
 - Pass title={getEventTooltip(r)} on event items
 - In month view, call with compact=true; in week/day views, call with compact=false

 4. Status legend

 File: src/components/CalendarView/index.tsx

 - Add renderStatusLegend() function that maps STATUS_CLASS_MAP entries to labeled color dots
 - Render it between the header and the calendar grid

 File: src/components/CalendarView/CalendarView.module.css

 - Add .statusLegend, .legendItem, .legendDot styles

 5. Current time indicator (week/day views)

 File: src/components/CalendarView/index.tsx

 - In renderWeekView and renderDayView, check if the current hour matches the cell's hour and if the current date matches the cell's date
 - If so, render an absolutely-positioned red line at (currentMinutes / 60) * 100% from the top of the cell

 File: src/components/CalendarView/CalendarView.module.css

 - Add .currentTimeLine style (absolute position, red, 2px height, full width, z-index above events)

 6. Integration tests for admin-create-as-confirmed

 File: dev/int.spec.ts

 - Add test: "admin user can create reservation as confirmed" — pass user to payload.create() to simulate admin context, create with status: 'confirmed', assert it succeeds
 - Add test: "admin user cannot create reservation as completed" — same admin context, status: 'completed' should still throw
 - Existing test "new reservations must start as pending" stays unchanged (no user = public context, confirmed still rejected)

 Files Modified (summary)
 ┌─────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                        File                         │                                              Changes                                               │
 ├─────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ src/hooks/reservations/validateStatusTransition.ts  │ Add req arg; allow confirmed on create when req.user exists                                        │
 ├─────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ src/components/CalendarView/index.tsx               │ Click-to-create on cells, initialData, enhanced labels, tooltips, status legend, current time line │
 ├─────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ src/components/CalendarView/CalendarView.module.css │ Clickable cell styles, legend styles, current time indicator styles                                │
 ├─────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ dev/int.spec.ts                                     │ 2 new tests for admin-create-as-confirmed behavior                                                 │
 └─────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────┘
 Verification

 1. pnpm build — ensure compilation
 2. pnpm test:int — all 13 existing tests pass + 2 new tests pass
 3. pnpm dev — manual admin panel testing:
   - Create New button still works (opens empty form in drawer)
   - Clicking a day cell in month view opens drawer with startTime pre-filled to 9:00 AM that day
   - Clicking a time cell in week/day view opens drawer with that exact hour pre-filled
   - Clicking an existing event opens drawer in edit mode (not create)
   - Status field in drawer shows correct options; can change status and save
   - Creating a reservation from admin allows selecting "confirmed" as initial status
   - After save, calendar refreshes automatically
   - Status legend visible below the header
   - Hovering events shows tooltip with full details
   - Current time red line visible in week/day views at the correct position