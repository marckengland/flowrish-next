# Requirements Document

## Introduction

A lead management system for tracking sales leads through a pipeline, managing contacts and companies, logging activities, scoring leads, and providing reporting dashboards. The system supports centralized email integration, task management, CSV import/export, and role-based access control — similar in scope to tools like Salesforce and HubSpot.

## Glossary

- **Lead_Management_System**: The overall application that manages leads, contacts, companies, activities, tasks, scoring, and reporting.
- **Lead**: A potential sales opportunity tracked through pipeline stages.
- **Pipeline**: An ordered sequence of stages that a lead progresses through from creation to close.
- **Stage**: A named step within a pipeline (e.g., "New", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost").
- **Contact**: An individual person associated with one or more leads.
- **Company**: An organization that contacts belong to, linkable to leads.
- **Activity**: A logged event on a lead's timeline, such as a call, meeting, note, or email.
- **Activity_Timeline**: A chronological view of all activities associated with a single lead.
- **Task**: An actionable item with an assignee, due date, and completion status, linked to a lead.
- **Reminder**: A scheduled notification triggered before a task's due date.
- **Lead_Score**: A numeric ranking assigned to a lead based on engagement, deal size, or custom criteria.
- **Scoring_Rule**: A configurable rule that defines how lead score points are awarded or deducted.
- **Dashboard**: A visual reporting interface displaying pipeline metrics, conversion rates, and stage duration.
- **CSV_Importer**: The component responsible for parsing and importing leads from CSV files.
- **CSV_Exporter**: The component responsible for exporting lead data to CSV format.
- **Role**: A permission level assigned to a user (e.g., "Team Member", "Manager", "Admin").
- **Email_Integration**: The component that connects to external email providers (e.g., Gmail) to sync emails with leads.
- **User**: An authenticated person who interacts with the Lead_Management_System.
- **Duplicate_Detector**: The component responsible for identifying potential duplicate Leads based on matching contact email or company name.
- **Assignment_Engine**: The component responsible for automatically assigning Leads to Users based on configurable rules.
- **Assignment_Rule**: A configurable rule that defines how Leads are routed to Users (e.g., territory, deal size, round-robin).
- **Audit_Log**: A chronological record of all create, update, and delete operations performed on Leads, Contacts, Companies, and Pipeline changes.
- **Audit_Entry**: A single record in the Audit_Log capturing the User, action, entity, changed fields, and timestamp.
- **Search_Engine**: The component responsible for full-text search and filtered queries across Leads, Contacts, and Companies.
- **Field_Mapping**: A user-defined mapping between CSV column headers and Lead_Management_System fields used during CSV import.
- **Score_Decay**: A rule that reduces a Lead_Score by a configured amount when a Lead has no new Activity for a specified number of days.

## Requirements

### Requirement 1: Lead Pipeline and Stage Tracking

**User Story:** As a sales representative, I want to track leads through pipeline stages, so that I can monitor deal progress and prioritize my efforts.

#### Acceptance Criteria

1. THE Lead_Management_System SHALL allow a User to create a Lead with a name, description, estimated deal value, and an assigned Stage.
2. WHEN a User moves a Lead to a different Stage, THE Lead_Management_System SHALL record the timestamp of the Stage transition.
3. THE Lead_Management_System SHALL display all Leads grouped by their current Stage in a pipeline view.
4. WHEN a User creates a new Pipeline, THE Lead_Management_System SHALL require at least two Stages to be defined.
5. THE Lead_Management_System SHALL allow a User to reorder Stages within a Pipeline.
6. WHEN a Lead is moved to a "Closed Won" or "Closed Lost" Stage, THE Lead_Management_System SHALL mark the Lead as closed and record the close date.
7. IF a User attempts to create a Lead without a name, THEN THE Lead_Management_System SHALL display a validation error and prevent Lead creation.

### Requirement 2: Contact and Company Management

**User Story:** As a sales representative, I want to link leads to contacts and companies, so that I can understand the organizational context of each deal.

#### Acceptance Criteria

1. THE Lead_Management_System SHALL allow a User to create a Contact with a name, email address, phone number, and job title.
2. THE Lead_Management_System SHALL allow a User to create a Company with a name, industry, and website.
3. WHEN a User associates a Contact with a Company, THE Lead_Management_System SHALL display that Contact under the Company's contact list.
4. THE Lead_Management_System SHALL allow a User to link multiple Contacts to a single Lead.
5. THE Lead_Management_System SHALL allow a User to link a Lead to exactly one Company.
6. WHEN a User views a Company, THE Lead_Management_System SHALL display all Leads associated with that Company.
7. IF a User attempts to delete a Company that has associated Leads, THEN THE Lead_Management_System SHALL prompt the User for confirmation before deletion.

### Requirement 3: Centralized Email Integration

**User Story:** As a sales representative, I want to sync my Gmail emails with leads, so that I can view all communication in one place without switching tools.

#### Acceptance Criteria

1. THE Email_Integration SHALL support connecting to Gmail via OAuth 2.0 authentication.
2. THE Email_Integration SHALL use a provider-agnostic interface so that additional email providers (e.g., Outlook, Yahoo) can be added without modifying core sync or logging logic.
3. WHEN a User connects an email account, THE Email_Integration SHALL sync emails from the connected account that match Contacts linked to Leads.
4. WHEN a new email is received from a Contact linked to a Lead, THE Email_Integration SHALL automatically log the email as an Activity on that Lead's Activity_Timeline.
5. THE Email_Integration SHALL allow a User to compose and send an email to a Contact directly from a Lead's detail view.
6. WHEN a User sends an email through the Lead_Management_System, THE Email_Integration SHALL log the sent email as an Activity on the Lead's Activity_Timeline.
7. IF the OAuth 2.0 token expires, THEN THE Email_Integration SHALL prompt the User to re-authenticate.
8. IF the email sync fails due to a network error, THEN THE Email_Integration SHALL retry the sync up to 3 times and display an error notification to the User after all retries are exhausted.
9. WHEN a new email provider is registered, THE Email_Integration SHALL validate that the provider implements the required authentication, send, and sync interfaces before activation.

### Requirement 4: Activity Timeline

**User Story:** As a sales representative, I want to see all calls, meetings, notes, and emails for a lead in one chronological view, so that I can quickly understand the full history of interactions.

#### Acceptance Criteria

1. THE Lead_Management_System SHALL display an Activity_Timeline for each Lead showing all Activities in reverse chronological order (newest first).
2. THE Lead_Management_System SHALL support the following Activity types: Call, Meeting, Note, Email, and File Attachment.
3. WHEN a User logs a Call Activity, THE Lead_Management_System SHALL record the call date, duration, and notes.
4. WHEN a User logs a Meeting Activity, THE Lead_Management_System SHALL record the meeting date, attendees, and notes.
5. WHEN a User logs a Note Activity, THE Lead_Management_System SHALL record the note text and creation timestamp.
6. THE Lead_Management_System SHALL display each Activity on the Activity_Timeline with the Activity type, date, and a summary.
7. WHEN a User filters the Activity_Timeline by Activity type, THE Lead_Management_System SHALL display only Activities matching the selected type.
8. THE Lead_Management_System SHALL allow a User to attach one or more files (up to 25 MB per file) to any Activity on a Lead's Activity_Timeline.
9. WHEN a User attaches a file to an Activity, THE Lead_Management_System SHALL record the file name, file size, upload timestamp, and the uploading User.
10. THE Lead_Management_System SHALL allow a User to download or preview an attached file from the Activity_Timeline.
11. IF a User attempts to attach a file exceeding 25 MB, THEN THE Lead_Management_System SHALL reject the upload and display a validation error indicating the maximum file size.

### Requirement 5: Task and Reminder System

**User Story:** As a sales representative, I want to create follow-up tasks with due dates and reminders, so that I never miss an important action on a lead.

#### Acceptance Criteria

1. THE Lead_Management_System SHALL allow a User to create a Task linked to a Lead with a title, description, assignee, due date, and priority level (Low, Medium, High).
2. WHEN a Task's due date is within 24 hours, THE Lead_Management_System SHALL send a Reminder notification to the assigned User.
3. WHEN a User marks a Task as complete, THE Lead_Management_System SHALL record the completion timestamp and log the completion as an Activity on the associated Lead's Activity_Timeline.
4. THE Lead_Management_System SHALL display all Tasks assigned to a User in a task list view, sorted by due date.
5. WHILE a Task is overdue, THE Lead_Management_System SHALL visually highlight the Task in the task list view.
6. THE Lead_Management_System SHALL allow a User to reassign a Task to a different User.
7. IF a User attempts to create a Task without a due date, THEN THE Lead_Management_System SHALL display a validation error and prevent Task creation.

### Requirement 6: Lead Scoring

**User Story:** As a sales manager, I want leads to be automatically scored based on engagement and deal size, so that my team can focus on the highest-value opportunities.

#### Acceptance Criteria

1. THE Lead_Management_System SHALL calculate a Lead_Score for each Lead as a numeric value between 0 and 100.
2. WHEN a new Activity is logged on a Lead, THE Lead_Management_System SHALL recalculate the Lead_Score for that Lead.
3. THE Lead_Management_System SHALL allow a User with Manager or Admin Role to create, edit, and delete Scoring_Rules.
4. THE Lead_Management_System SHALL support Scoring_Rules based on: number of Activities, deal value, Stage progression, and email engagement.
5. WHEN a Lead_Score changes, THE Lead_Management_System SHALL record the previous score and the new score with a timestamp.
6. THE Lead_Management_System SHALL display Leads sorted by Lead_Score in a ranked list view.
7. IF no Scoring_Rules are configured, THEN THE Lead_Management_System SHALL assign a default Lead_Score of 0 to all Leads.
8. THE Lead_Management_System SHALL allow a User with Manager or Admin Role to configure a Score_Decay rule specifying the inactivity threshold in days and the point reduction amount.
9. WHEN a Lead has no new Activity for the number of days specified in the Score_Decay rule, THE Lead_Management_System SHALL reduce the Lead_Score by the configured point reduction amount.
10. THE Lead_Management_System SHALL evaluate Score_Decay daily and apply the reduction to all eligible Leads.
11. THE Lead_Management_System SHALL not reduce a Lead_Score below 0 when applying Score_Decay.

### Requirement 7: Reporting and Dashboards

**User Story:** As a sales manager, I want to view conversion rates, pipeline value, and stage duration metrics, so that I can identify bottlenecks and forecast revenue.

#### Acceptance Criteria

1. THE Dashboard SHALL display the total pipeline value grouped by Stage.
2. THE Dashboard SHALL display the conversion rate between each consecutive pair of Stages in a Pipeline.
3. THE Dashboard SHALL display the average duration a Lead spends in each Stage.
4. WHEN a User selects a date range filter, THE Dashboard SHALL display metrics calculated only for Leads active within the selected date range.
5. THE Dashboard SHALL display a count of Leads in each Stage.
6. THE Dashboard SHALL display the total number of Leads closed as "Closed Won" and "Closed Lost" within a selected date range.
7. THE Lead_Management_System SHALL refresh Dashboard data when a User navigates to the Dashboard view.

### Requirement 8: CSV Import and Export

**User Story:** As a sales operations manager, I want to import leads from CSV files and export lead data for reporting, so that I can migrate data and share reports with stakeholders.

#### Acceptance Criteria

1. WHEN a User uploads a CSV file, THE CSV_Importer SHALL parse the file and create Leads from each valid row.
2. THE CSV_Importer SHALL validate that each row contains at minimum a lead name and a valid Stage.
3. IF a CSV row contains invalid or missing required data, THEN THE CSV_Importer SHALL skip the invalid row and include the row number and error description in an import summary report.
4. WHEN the import completes, THE CSV_Importer SHALL display a summary showing the count of successfully imported Leads and the count of skipped rows.
5. THE CSV_Exporter SHALL export Lead data including lead name, Stage, deal value, Contact names, Company name, Lead_Score, and close date to a CSV file.
6. THE CSV_Exporter SHALL format the exported CSV file with a header row matching the exported field names.
7. FOR ALL valid Lead data, importing a CSV export and then exporting the result SHALL produce an equivalent CSV file (round-trip property).
8. WHEN a User uploads a CSV file, THE CSV_Importer SHALL present a Field_Mapping interface allowing the User to map each CSV column header to a Lead_Management_System field.
9. THE CSV_Importer SHALL allow a User to save a Field_Mapping configuration for reuse in future imports.
10. THE CSV_Importer SHALL display a preview of the first 5 rows with the applied Field_Mapping before executing the import.
11. IF a required Lead_Management_System field is not mapped to any CSV column, THEN THE CSV_Importer SHALL display a validation error and prevent the import from starting.

### Requirement 9: Role-Based Access Control

**User Story:** As an administrator, I want to control what data team members and managers can access, so that sensitive deal information is appropriately restricted.

#### Acceptance Criteria

1. THE Lead_Management_System SHALL support three Roles: Team Member, Manager, and Admin.
2. WHILE a User has the Team Member Role, THE Lead_Management_System SHALL restrict the User to viewing and editing only Leads assigned to that User.
3. WHILE a User has the Manager Role, THE Lead_Management_System SHALL allow the User to view and edit all Leads across the team.
4. WHILE a User has the Admin Role, THE Lead_Management_System SHALL allow the User to manage Roles, Users, Pipelines, and Scoring_Rules in addition to all Manager permissions.
5. WHEN a User with the Team Member Role attempts to access a Lead not assigned to that User, THE Lead_Management_System SHALL deny access and display an "Access Denied" message.
6. THE Lead_Management_System SHALL allow a User with the Admin Role to assign and change Roles for other Users.
7. IF a User's Role is changed, THEN THE Lead_Management_System SHALL apply the new permissions immediately without requiring the User to log out.

### Requirement 10: Duplicate Lead Detection

**User Story:** As a sales representative, I want the system to flag potential duplicate leads when creating or importing, so that I can keep the data clean and avoid working the same opportunity twice.

#### Acceptance Criteria

1. WHEN a User creates a new Lead, THE Duplicate_Detector SHALL check for existing Leads with a matching Contact email address or Company name.
2. WHEN the CSV_Importer processes a row, THE Duplicate_Detector SHALL check for existing Leads with a matching Contact email address or Company name.
3. WHEN the Duplicate_Detector identifies one or more potential duplicates, THE Lead_Management_System SHALL display a list of matching Leads to the User before confirming creation.
4. THE Lead_Management_System SHALL allow a User to proceed with Lead creation after reviewing flagged duplicates.
5. THE Lead_Management_System SHALL allow a User to merge a new Lead with an existing duplicate Lead, combining Activities and Contacts from both records.
6. WHEN a merge is performed, THE Lead_Management_System SHALL retain the Activity_Timeline entries from both Leads on the merged Lead.
7. THE Duplicate_Detector SHALL perform case-insensitive matching when comparing email addresses and Company names.

### Requirement 11: Lead Assignment Rules

**User Story:** As a sales manager, I want leads to be automatically assigned to team members based on configurable rules, so that I do not have to manually route every new lead.

#### Acceptance Criteria

1. THE Lead_Management_System SHALL allow a User with Manager or Admin Role to create, edit, and delete Assignment_Rules.
2. THE Assignment_Engine SHALL support assignment based on territory, deal size range, and round-robin rotation.
3. WHEN a new Lead is created and Assignment_Rules are configured, THE Assignment_Engine SHALL evaluate the rules and assign the Lead to the matching User.
4. WHEN multiple Assignment_Rules match a Lead, THE Assignment_Engine SHALL apply the rule with the highest configured priority.
5. IF no Assignment_Rule matches a Lead, THEN THE Assignment_Engine SHALL leave the Lead unassigned and notify Users with the Manager Role.
6. WHEN the Assignment_Engine assigns a Lead, THE Lead_Management_System SHALL send a notification to the assigned User.
7. THE Lead_Management_System SHALL allow a User with Manager or Admin Role to manually override an automatic assignment.

### Requirement 12: Audit Log

**User Story:** As an administrator, I want to see a complete history of who changed what and when across leads, contacts, and pipeline changes, so that I can maintain accountability and support compliance requirements.

#### Acceptance Criteria

1. WHEN a User creates, updates, or deletes a Lead, Contact, Company, or Stage transition, THE Lead_Management_System SHALL create an Audit_Entry recording the User, action type, entity type, entity identifier, and timestamp.
2. WHEN a User updates a field on a Lead, Contact, or Company, THE Audit_Log SHALL record the field name, previous value, and new value in the Audit_Entry.
3. THE Lead_Management_System SHALL allow a User with Admin Role to view the Audit_Log filtered by entity type, User, action type, and date range.
4. THE Lead_Management_System SHALL retain Audit_Log entries for a minimum of 365 days.
5. THE Lead_Management_System SHALL prevent any User from editing or deleting Audit_Log entries.
6. THE Lead_Management_System SHALL display Audit_Log entries in reverse chronological order.
7. WHEN a User views a specific Lead, Contact, or Company, THE Lead_Management_System SHALL display the Audit_Log entries related to that entity.

### Requirement 13: Search and Filtering

**User Story:** As a sales representative, I want to search and filter across leads, contacts, and companies, so that I can quickly find the records I need without scrolling through long lists.

#### Acceptance Criteria

1. THE Search_Engine SHALL support full-text search across Lead names, Contact names, Contact email addresses, and Company names.
2. WHEN a User enters a search query, THE Search_Engine SHALL return matching results within 500 milliseconds for datasets up to 100,000 records.
3. THE Search_Engine SHALL allow a User to filter Leads by Stage, Lead_Score range, date range (created or last modified), and assigned User.
4. THE Search_Engine SHALL allow a User to combine multiple filters with the search query.
5. WHEN a User applies filters, THE Search_Engine SHALL display the count of matching results.
6. THE Search_Engine SHALL display search results with the entity type, name, and a contextual snippet showing where the match occurred.
7. WHEN a User clears all filters and the search query, THE Search_Engine SHALL display the default unfiltered view.
