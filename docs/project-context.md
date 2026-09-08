# Forest Lake Pathfinder application context

Last researched: September 8, 2026.

## User-stated purpose

Build a web application to store student data for Forest Lake SDA Pathfinders. The original repository description includes both past and current youth records. Specific fields, workflows, access roles, and implementation choices remain to be defined.

## Forest Lake ministry

Forest Lake Pathfinders emphasizes learning about Jesus through the Bible and nature, serving others, and developing Christian character. Its dedicated website provides local ministry background. [Source: Forest Lake Pathfinders](https://pathfindersflc.org/).

The club is based at Forest Lake Seventh-day Adventist Church, 515 Harley Lester Lane, Apopka, FL 32703. [Source: club contact page](https://pathfindersflc.org/contact-us/).

The church's 2026–2027 registration describes eligibility as grades 5–12 or age 10 and above. It lists these classes:

| Grade | Class | Division |
| --- | --- | --- |
| 5 | Friend | E-Tracker |
| 6 | Companion | E-Tracker |
| 7 | Explorer | E-Tracker |
| 8 | Ranger | E-Tracker |
| 9 | Voyager | Varsity |
| 10 | Guide | Varsity |
| 11 | Pioneer | Varsity |
| 12 | Navigator | Varsity |

Activities include Pathfinder Bible Experience (Bible Bowl), Drum Corps, Drill Team, and Teen Leadership Training (grade 9+). Registration distinguishes new and returning members, collects guardian details, and requires a notarized medical consent form per child. Adult overnight participation requires volunteer eligibility screening. These are published season-specific practices, not yet application requirements. [Source: 2026–2027 registration](https://forestlake.churchcenter.com/registrations/events/3638481).

Church Center also hosts class and activity groups, including Drums, Drill, and PBE. This establishes an existing administrative platform; whether the new app supplements it or exchanges data with it is undecided. [Source: church Pathfinder groups](https://forestlake.churchcenter.com/groups/pathfinders).

## Florida Conference context

The Florida Conference Pathfinder and Adventurer Department supports youth ministry through activities, level work, service, and trips. Its Pathfinder resource hub links to calendars, director resources, YMMS, and YMMS tutorials. YMMS is an existing system to investigate before deciding on integration or duplicate record entry; no API or integration capability has been verified. [Source: Florida Conference Pathfinders](https://floridaconference.com/pathfinders/).

Florida's Pathfinder ministry serves grades 5–12; the Conference contrasts this with grades 5–10 in the North American Division. Adventurers is a separate ministry for pre-kindergarten through grade 4. The Conference organizes its support into North, Central, West, and South areas, with zone and cluster leadership. Forest Lake's specific area, zone, and cluster were not verified. [Source: Conference organization](https://floridaconference.com/how-we-are-organized/).

## Source freshness and conflicts

- The dedicated club homepage features a 2024 induction, so it is useful for mission context but should not establish current operational details.
- The Church Center group titled 2025–2026 lists second and fourth Sabbaths; the 2026–2027 registration says generally first and third Saturdays and directs families to the club calendar. Confirm actual dates before implementing scheduling. [Older group](https://forestlake.churchcenter.com/unproxy/groups/pathfinders/pathfinders), [newer registration](https://forestlake.churchcenter.com/registrations/events/3638481).
- Class assignments, fees, staff, eligibility procedures, and event information can change each season. Recheck their source when implementing related features.

## Preliminary design implications

These are planning inferences, not approved feature requirements:

- Keep a student's identity separate from annual enrollment so class, grade, and participation history can be preserved across club years.
- Model guardians separately from students to support siblings and multiple guardians.
- Treat class enrollment and optional team membership as separate relationships.
- Consider student profiles, enrollment, and searchable rosters as an initial scope; attendance, honors, events, fees, and documents need prioritization with the user.
- Plan authenticated access and permissions around staff responsibilities because records concern minors. Use synthetic student data in development and keep actual student records and medical documents out of the repository.
- Determine whether medical consent needs only a completion status or actual document storage before designing that feature.

## Decisions still needed before implementation

- Initial student fields and the source/format of any historical records.
- Who can view or edit records, and whether parents or students need accounts.
- Which workflows belong in the first release.
- Relationship to Church Center and YMMS, including any authorized import/export needs.
- Hosting, backups, and record retention expectations. The initial stack is React/TypeScript with Vite and Supabase PostgreSQL; see the README for setup status.

No student records were collected during this research.
