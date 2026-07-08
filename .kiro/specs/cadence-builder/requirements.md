# Requirements Document

## Introduction

The Cadence Builder is a Salesloft-style workflow engine for outbound sales sequences. A cadence is a state machine that moves a person (lead/contact) through a series of timed steps, where each step is an action (email, call, LinkedIn message, or manual task) with a configurable delay. The system supports automated execution via BullMQ, human-in-the-loop manual steps, conditional exits on reply/meeting events, and analytics for tracking cadence performance. The Cadence Builder is a first-class feature with its own top-level navigation entry, accessible to all roles with appropriate permissions.

## Glossary

- **Cadence**: A reusable workflow template containing an ordered sequence of steps that define an outbound sales sequence.
- **CadenceStep**: A single node in a cadence workflow, specifying an action type, a delay before execution, an optional email template reference, and its position in the sequence.
- **Enrollment**: An instance created when a lead is added to a cadence, tracking the lead's current step, status, and progress through the workflow.
- **ActionType**: The type of action a step performs. One of: EMAIL, CALL, LINKEDIN, MANUAL_TASK.
- **EnrollmentStatus**: The lifecycle state of an enrollment. One of: ACTIVE, PAUSED, COMPLETED, EXITED.
- **CadenceStatus**: The lifecycle state of a cadence template. One of: DRAFT, ACTIVE, ARCHIVED.
- **Execution_Engine**: The BullMQ-based scheduler that processes due steps for active enrollments by creating delayed jobs.
- **Conditional_Exit**: An event-driven rule that automatically removes a lead from a cadence when a qualifying event occurs (e.g., email reply received, meeting booked).
- **Step_Execution_Log**: An activity record created each time a step is executed for an enrollment, capturing the action taken and outcome.
- **Cadence_Builder_UI**: The frontend visual interface for creating and editing cadence step sequences.
- **Cadence_List_Page**: The frontend page displaying all cadences with summary metrics.
- **Enrollment_Manager**: The frontend interface for enrolling leads into cadences and viewing enrollment progress.

## Requirements

### Requirement 1: Cadence CRUD

**User Story:** As a manager or admin, I want to create, view, edit, and delete cadence templates, so that I can define reusable outbound sales sequences for my team.

#### Acceptance Criteria

1. WHEN a user with ADMIN or MANAGER role submits a valid cadence name, THE Cadence_Builder_UI SHALL create a new cadence in DRAFT status and display the cadence detail view.
2. THE Cadence_List_Page SHALL display all cadences with their name, status, step count, and active enrollment count, ordered by creation date descending.
3. WHEN a user with ADMIN or MANAGER role updates a cadence name or status, THE Cadence_Builder_UI SHALL persist the changes and display the updated cadence.
4. WHEN a user with ADMIN or MANAGER role deletes a cadence that has zero active enrollments, THE Cadence_Builder_UI SHALL remove the cadence and redirect to the Cadence_List_Page.
5. IF a user attempts to delete a cadence that has active enrollments, THEN THE Cadence_Builder_UI SHALL display an error message stating the cadence cannot be deleted while enrollments are active.
6. WHEN a user with ADMIN or MANAGER role changes a cadence status from DRAFT to ACTIVE, THE Cadence_Builder_UI SHALL validate that the cadence contains at least one CadenceStep before allowing activation.
7. WHEN a user with ADMIN or MANAGER role changes a cadence status to ARCHIVED, THE Execution_Engine SHALL stop processing new steps for all enrollments in that cadence and set their EnrollmentStatus to EXITED.
8. WHEN a user with TEAM_MEMBER role views the Cadence_List_Page, THE Cadence_List_Page SHALL display cadences in read-only mode without create, edit, or delete controls.
9. IF a user without ADMIN or MANAGER role attempts to create, update, or delete a cadence via the API, THEN THE Cadence_Builder_UI SHALL return a 403 Forbidden response.

### Requirement 2: Step Builder

**User Story:** As a manager or admin, I want to add, remove, and reorder steps within a cadence, so that I can design the exact sequence of outreach actions and timing for my sales workflow.

#### Acceptance Criteria

1. WHEN a user adds a new step to a cadence, THE Cadence_Builder_UI SHALL require an ActionType (EMAIL, CALL, LINKEDIN, or MANUAL_TASK) and a delay value in hours (minimum 0).
2. WHEN a user adds a step with ActionType EMAIL, THE Cadence_Builder_UI SHALL allow the user to specify an email subject and body template.
3. THE Cadence_Builder_UI SHALL display all steps in a vertical ordered list showing step number, ActionType icon, delay duration, and template preview (for EMAIL steps).
4. WHEN a user removes a step from a cadence, THE Cadence_Builder_UI SHALL remove the step and re-number the remaining steps to maintain a contiguous sequence starting from 1.
5. WHEN a user reorders steps via drag-and-drop, THE Cadence_Builder_UI SHALL update the step order values and persist the new sequence.
6. WHEN a user reorders steps, THE Cadence_Builder_UI SHALL preserve the complete set of steps with no steps added or removed (reorder preserves step set).
7. IF a user attempts to add a step to a cadence that is in ARCHIVED status, THEN THE Cadence_Builder_UI SHALL display an error message stating archived cadences cannot be modified.
8. WHILE a cadence is in ACTIVE status with active enrollments, THE Cadence_Builder_UI SHALL allow adding new steps only at the end of the sequence and SHALL prohibit removing or reordering existing steps.

### Requirement 3: Lead Enrollment

**User Story:** As a sales rep, I want to enroll leads into cadences and track their progress, so that I can execute structured outbound sequences and know where each lead stands.

#### Acceptance Criteria

1. WHEN a user enrolls a lead into an ACTIVE cadence, THE Enrollment_Manager SHALL create an enrollment with EnrollmentStatus ACTIVE, set the current step to step 1, and schedule the first step execution in the Execution_Engine.
2. IF a user attempts to enroll a lead that is already actively enrolled in the same cadence, THEN THE Enrollment_Manager SHALL reject the enrollment and display an error message stating the lead is already enrolled.
3. WHEN a user with TEAM_MEMBER role enrolls a lead, THE Enrollment_Manager SHALL verify the lead is assigned to that user before allowing enrollment.
4. WHEN a user with ADMIN or MANAGER role enrolls a lead, THE Enrollment_Manager SHALL allow enrollment regardless of lead assignment.
5. THE Enrollment_Manager SHALL display all enrollments for a cadence with lead name, current step number, EnrollmentStatus, and enrollment date.
6. WHEN a user pauses an active enrollment, THE Enrollment_Manager SHALL set the EnrollmentStatus to PAUSED and THE Execution_Engine SHALL cancel any pending scheduled jobs for that enrollment.
7. WHEN a user resumes a paused enrollment, THE Enrollment_Manager SHALL set the EnrollmentStatus to ACTIVE and THE Execution_Engine SHALL schedule the next due step execution.
8. WHEN a user manually removes a lead from a cadence, THE Enrollment_Manager SHALL set the EnrollmentStatus to EXITED and THE Execution_Engine SHALL cancel any pending scheduled jobs for that enrollment.
9. THE Enrollment_Manager SHALL support bulk enrollment of multiple leads into a cadence in a single operation.
10. IF a user attempts to enroll a lead into a cadence that is not in ACTIVE status, THEN THE Enrollment_Manager SHALL reject the enrollment and display an error message stating only ACTIVE cadences accept enrollments.

### Requirement 4: Execution Engine

**User Story:** As a sales team, I want the system to automatically process cadence steps on schedule, so that outreach actions happen at the right time without manual intervention.

#### Acceptance Criteria

1. WHEN an enrollment reaches a due step (current time >= scheduled execution time), THE Execution_Engine SHALL pick up the job from the BullMQ queue and execute the step action.
2. WHEN the Execution_Engine executes a step, THE Execution_Engine SHALL create a Step_Execution_Log recording the enrollment ID, step ID, action type, execution timestamp, and outcome (success or failure).
3. WHEN the Execution_Engine completes a step successfully, THE Execution_Engine SHALL advance the enrollment to the next step and schedule a new delayed job based on the next step's delay value.
4. WHEN the Execution_Engine completes the final step of a cadence for an enrollment, THE Execution_Engine SHALL set the EnrollmentStatus to COMPLETED.
5. IF the Execution_Engine fails to execute a step, THEN THE Execution_Engine SHALL retry the job up to 3 times with exponential backoff and log each failure in the Step_Execution_Log.
6. IF the Execution_Engine exhausts all retry attempts for a step, THEN THE Execution_Engine SHALL set the EnrollmentStatus to PAUSED and create a Task assigned to the lead's assigned user describing the failure.
7. WHILE an enrollment has EnrollmentStatus PAUSED, THE Execution_Engine SHALL skip processing for that enrollment.
8. THE Execution_Engine SHALL process enrollments concurrently, supporting at least 1000 active enrollments across all cadences without job starvation.

### Requirement 5: Action Execution

**User Story:** As a sales rep, I want cadence steps to perform the correct action for each step type, so that emails are sent automatically and manual tasks are created for actions requiring human involvement.

#### Acceptance Criteria

1. WHEN the Execution_Engine executes a step with ActionType EMAIL, THE Execution_Engine SHALL send an email using the enrolled lead's primary contact email address and the step's email template, via the enrolling user's connected EmailAccount.
2. WHEN the Execution_Engine executes a step with ActionType CALL, THE Execution_Engine SHALL create a Task with title "Call: {lead name}" assigned to the lead's assigned user with a due date of the current timestamp.
3. WHEN the Execution_Engine executes a step with ActionType LINKEDIN, THE Execution_Engine SHALL create a Task with title "LinkedIn: {lead name}" assigned to the lead's assigned user with a due date of the current timestamp.
4. WHEN the Execution_Engine executes a step with ActionType MANUAL_TASK, THE Execution_Engine SHALL create a Task with the step's configured title and description, assigned to the lead's assigned user with a due date of the current timestamp.
5. WHEN the Execution_Engine executes any step, THE Execution_Engine SHALL create an Activity record on the lead with the appropriate ActivityType (EMAIL for email steps, CALL for call steps, NOTE for LinkedIn and manual task steps).
6. IF the Execution_Engine attempts to send an email but the enrolling user has no connected EmailAccount, THEN THE Execution_Engine SHALL create a Task notifying the user to connect an email account and set the enrollment to PAUSED.

### Requirement 6: Conditional Exits

**User Story:** As a sales rep, I want leads to automatically exit a cadence when they reply to an email or book a meeting, so that I don't continue sending outreach to engaged prospects.

#### Acceptance Criteria

1. WHEN an inbound email is received from a contact associated with an actively enrolled lead, THE Execution_Engine SHALL set the enrollment's EnrollmentStatus to EXITED, cancel pending scheduled jobs, and create a Step_Execution_Log with outcome "reply_detected".
2. WHEN a MEETING activity is logged on a lead that is actively enrolled in a cadence, THE Execution_Engine SHALL set the enrollment's EnrollmentStatus to EXITED, cancel pending scheduled jobs, and create a Step_Execution_Log with outcome "meeting_booked".
3. WHEN an enrollment exits due to a conditional exit, THE Enrollment_Manager SHALL display the exit reason (reply_detected or meeting_booked) alongside the enrollment record.
4. THE Execution_Engine SHALL evaluate conditional exit events before executing any scheduled step, ensuring a lead that replied between step scheduling and step execution is not contacted again.

### Requirement 7: Cadence Analytics

**User Story:** As a manager, I want to see cadence performance metrics, so that I can evaluate which sequences are effective and optimize my team's outreach strategy.

#### Acceptance Criteria

1. THE Cadence_List_Page SHALL display for each cadence: total enrollments, active enrollments, completed enrollments, exited enrollments, and completion rate (completed / total enrollments as a percentage).
2. WHEN a user views a cadence detail page, THE Cadence_Builder_UI SHALL display per-step metrics: number of enrollments that reached the step, number of enrollments that completed the step, and number of enrollments that exited at the step.
3. WHEN a user views a cadence detail page, THE Cadence_Builder_UI SHALL display the average time from enrollment to completion for completed enrollments.
4. THE Cadence_Builder_UI SHALL update analytics data each time the cadence detail page is loaded, reflecting the current state of all enrollments.

### Requirement 8: Cadence Builder UI

**User Story:** As a user, I want a dedicated Cadence Builder section in the application with intuitive visual tools, so that I can easily create, manage, and monitor sales cadences.

#### Acceptance Criteria

1. THE Cadence_Builder_UI SHALL appear as a top-level navigation item labeled "Cadences" in the application sidebar, positioned between "Tasks" and "CSV Import/Export".
2. WHEN a user navigates to the Cadences page, THE Cadence_List_Page SHALL display a searchable, sortable list of all cadences with name, status badge, step count, active enrollments, and completion rate columns.
3. WHEN a user clicks "New Cadence", THE Cadence_Builder_UI SHALL display a form to enter the cadence name and then navigate to the step builder view.
4. THE Cadence_Builder_UI SHALL display the step sequence as a vertical timeline with each step showing its order number, ActionType icon, delay label (e.g., "Wait 2 days"), and a summary of the action configuration.
5. WHEN a user clicks on a step in the timeline, THE Cadence_Builder_UI SHALL open an inline editor panel for modifying the step's ActionType, delay, and template content.
6. THE Cadence_Builder_UI SHALL provide an "Enrollments" tab on the cadence detail page showing all enrolled leads with their current step, status, enrollment date, and exit reason (if applicable).
7. THE Cadence_Builder_UI SHALL provide an "Analytics" tab on the cadence detail page showing the metrics defined in Requirement 7.
8. THE Cadence_Builder_UI SHALL use Lucide icons consistent with the existing application icon set and follow the existing Tailwind CSS and shadcn/ui component patterns.

### Requirement 9: Role-Based Access Control

**User Story:** As an admin, I want cadence permissions to follow the existing RBAC model, so that team members can execute cadences while only managers and admins can design them.

#### Acceptance Criteria

1. WHEN a user with ADMIN or MANAGER role accesses the Cadence_Builder_UI, THE Cadence_Builder_UI SHALL display full create, edit, delete, and activation controls for cadences and steps.
2. WHEN a user with TEAM_MEMBER role accesses the Cadence_Builder_UI, THE Cadence_Builder_UI SHALL display cadences and enrollments in read-only mode, with the ability to enroll assigned leads, pause/resume own enrollments, and complete manual task steps.
3. THE Cadence_Builder_UI SHALL enforce that TEAM_MEMBER users can only enroll leads that are assigned to the TEAM_MEMBER user.
4. THE Cadence_Builder_UI SHALL enforce that TEAM_MEMBER users can only pause, resume, or remove enrollments for leads assigned to the TEAM_MEMBER user.
5. IF a user with TEAM_MEMBER role attempts to create, edit, or delete a cadence or step via the API, THEN THE Cadence_Builder_UI SHALL return a 403 Forbidden response.
