import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  ContractAssertion,
  FixtureDefinition,
  InteractionContract,
  Scenario,
} from "../shared/types.js";

export const digest = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");
export const fixtureDefinitions: FixtureDefinition[] = [
  {
    id: "northstar-appointments",
    name: "An appointment, within reach",
    organization: "Northstar Care",
    description:
      "A date picker that looks ready, until you put the mouse away.",
    task: "Choose an available appointment and confirm the booking using only the keyboard.",
    family: "date-picker",
    barrier:
      "The calendar dates respond to a click but cannot receive keyboard focus.",
    sourceFile: "DatePicker.jsx",
    tags: ["Date selection", "Focus restoration"],
    color: "#D9E8DF",
    ancestry: "authored-calendar-v1",
    supported: true,
  },
  {
    id: "riverside-support",
    name: "The right time to talk",
    organization: "Riverside Support",
    description: "Choose a support session from a custom appointment list.",
    task: "Select an available support session, enter your name, and save the correct appointment.",
    family: "combobox",
    barrier:
      "The appointment options are missing keyboard activation and their selection loses focus.",
    sourceFile: "SessionCombobox.jsx",
    tags: ["Combobox", "Keyboard selection"],
    color: "#E6DFD3",
    ancestry: "authored-combobox-v1",
    supported: true,
  },
  {
    id: "atlas-onboarding",
    name: "A first step forward",
    organization: "Atlas Learning",
    description:
      "A two-step orientation flow loses the way between selection and review.",
    task: "Complete both steps of the orientation booking dialog and confirm the chosen date.",
    family: "modal-wizard",
    barrier:
      "Moving to the review step leaves focus behind and the Continue control cannot be activated by keyboard.",
    sourceFile: "BookingWizard.jsx",
    tags: ["Modal dialog", "Multi-step flow"],
    color: "#DDDFF0",
    ancestry: "authored-wizard-v1",
    supported: true,
  },
  {
    id: "civic-assistance",
    name: "Room for a second try",
    organization: "Civic Advice",
    description:
      "Recover from a late availability error without losing the task.",
    task: "Recover when a session becomes unavailable, choose another date, and confirm the appointment.",
    family: "async-validation",
    barrier:
      "A late availability error leaves a mouse-only recovery control and no announced error.",
    sourceFile: "AvailabilityControl.jsx",
    tags: ["Async validation", "Error recovery"],
    color: "#EDDED5",
    ancestry: "authored-availability-v1",
    supported: true,
  },
  {
    id: "northstar-international",
    name: "Care in another language",
    organization: "Northstar International",
    description:
      "The calendar interaction with longer translated appointment names.",
    task: "Select and confirm an appointment with German labels using keyboard navigation.",
    family: "date-picker",
    barrier:
      "Translated dates share the calendar’s missing keyboard transition.",
    sourceFile: "DatePicker.jsx",
    tags: ["Localization", "Date selection"],
    color: "#D8E6E7",
    ancestry: "authored-calendar-v1",
    supported: true,
  },
  {
    id: "riverside-evening",
    name: "Support after hours",
    organization: "Riverside Evening",
    description:
      "Long appointment names and changing availability in the session picker.",
    task: "Select an available evening support session and confirm the exact requested date.",
    family: "combobox",
    barrier: "Custom option rows remain inaccessible to keyboard selection.",
    sourceFile: "SessionCombobox.jsx",
    tags: ["Long content", "Combobox"],
    color: "#E8E3D2",
    ancestry: "authored-combobox-v1",
    supported: true,
  },
];

export const scenarioDefinitions: Scenario[] = [
  {
    id: "baseline",
    name: "Original conditions",
    description:
      "English labels, standard timing, and the declared appointment availability.",
    locale: "en",
    delayedValidationMs: 120,
    unavailableFirst: false,
    longLabels: false,
    seed: 1701,
  },
  {
    id: "unavailable-date",
    name: "The first date is unavailable",
    description: "The first visible appointment cannot be selected or saved.",
    locale: "en",
    delayedValidationMs: 120,
    unavailableFirst: true,
    longLabels: false,
    seed: 2907,
  },
  {
    id: "late-validation",
    name: "A slower response",
    description: "Availability and booking responses arrive after 900 ms.",
    locale: "en",
    delayedValidationMs: 900,
    unavailableFirst: false,
    longLabels: false,
    seed: 3613,
  },
  {
    id: "long-labels",
    name: "Room for longer words",
    description: "Long service names exercise layout and accessible names.",
    locale: "en",
    delayedValidationMs: 120,
    unavailableFirst: false,
    longLabels: true,
    seed: 4507,
  },
  {
    id: "german",
    name: "A different language",
    description:
      "German dates and labels, with the same independent task outcome.",
    locale: "de",
    delayedValidationMs: 120,
    unavailableFirst: false,
    longLabels: true,
    seed: 5711,
  },
  {
    id: "combined",
    name: "All at once",
    description:
      "German labels, late validation, long content, and an unavailable first date.",
    locale: "de",
    delayedValidationMs: 900,
    unavailableFirst: true,
    longLabels: true,
    seed: 6803,
  },
];

export function effectiveScenario(
  fixtureId: string,
  requested: Scenario,
): Scenario {
  const scenario = structuredClone(requested);
  if (fixtureId === "northstar-international") {
    scenario.locale = "de";
    scenario.longLabels = true;
    if (scenario.id === "baseline")
      scenario.description =
        "German labels, long translated appointment names, standard timing, and the declared availability.";
  }
  if (fixtureId === "riverside-evening") scenario.longLabels = true;
  return scenario;
}

const assertions: ContractAssertion[] = [
  {
    id: "control_keyboard_reachable",
    label: "Reach the appointment control",
    description: "Tab navigation reaches a named appointment control.",
    enabled: true,
    required: true,
    source: "Task requirement · keyboard access",
    evidenceType: "browser",
  },
  {
    id: "selection_keyboard_operable",
    label: "Choose a date with the keyboard",
    description:
      "A permitted date can be selected without a pointer, including the recovery or review step.",
    enabled: true,
    required: true,
    source: "Task requirement · selection and recovery",
    evidenceType: "browser",
  },
  {
    id: "focus_restored",
    label: "Keep a place in the journey",
    description: "Closing a completed selection returns focus to its trigger.",
    enabled: true,
    required: true,
    source: "WAI-ARIA APG dialog interaction",
    evidenceType: "browser",
  },
  {
    id: "required_validation_preserved",
    label: "Keep required information required",
    description: "An empty name or date cannot create a booking.",
    enabled: true,
    required: true,
    source: "Independent appointment service invariant",
    evidenceType: "backend",
  },
  {
    id: "unavailable_slot_rejected",
    label: "Protect unavailable appointments",
    description: "The service rejects any attempt to save an unavailable date.",
    enabled: true,
    required: true,
    source: "Independent appointment service invariant",
    evidenceType: "backend",
  },
  {
    id: "correct_outcome_persisted",
    label: "Store the date that was chosen",
    description:
      "The actual appointment record matches the selected available date and entered name.",
    enabled: true,
    required: true,
    source: "Independent outcome oracle",
    evidenceType: "backend",
  },
  {
    id: "confirmation_focus",
    label: "Arrive at the confirmation",
    description:
      "The confirmation heading receives focus after a real successful save.",
    enabled: true,
    required: true,
    source: "Task requirement · completion",
    evidenceType: "browser",
  },
  {
    id: "dialog_escape",
    label: "Leave the picker with Escape",
    description:
      "Escape closes the picker and restores focus without changing the selection.",
    enabled: true,
    required: false,
    source: "WAI-ARIA APG keyboard guidance",
    evidenceType: "browser",
  },
  {
    id: "error_announced",
    label: "Expose recovery messages",
    description:
      "Validation errors are present in a live region or alert. Actual screen-reader speech still needs human review.",
    enabled: true,
    required: false,
    source: "DOM semantics · not recorded speech",
    evidenceType: "browser",
  },
];

export function getFixture(fixtureId: string) {
  const fixture = fixtureDefinitions.find((item) => item.id === fixtureId);
  if (!fixture)
    throw new Error(
      "Unsupported fixture. Choose one of the authored React applications.",
    );
  return fixture;
}

export function createContract(fixtureId: string): InteractionContract {
  const fixture = getFixture(fixtureId);
  const contract = {
    id: randomUUID(),
    version: 1,
    createdAt: new Date().toISOString(),
    reviewer: "Authored development contract · specialist review pending",
    task: fixture.task,
    preconditions: [
      "Fictional appointment data only",
      "An isolated session at an immutable source digest",
      "Keyboard navigation in Chromium",
    ],
    assertions: structuredClone(assertions),
    transitions: [
      {
        from: "appointment_form",
        action: "Open appointment options with the keyboard",
        to: "picker_open",
        assertionIds: ["control_keyboard_reachable", "dialog_escape"] as const,
      },
      {
        from: "picker_open",
        action: "Select an available date and recover from any late error",
        to: "date_selected",
        assertionIds: [
          "selection_keyboard_operable",
          "focus_restored",
          "error_announced",
        ] as const,
      },
      {
        from: "date_selected",
        action: "Enter the required name and confirm the booking",
        to: "appointment_confirmed",
        assertionIds: [
          "required_validation_preserved",
          "unavailable_slot_rejected",
          "correct_outcome_persisted",
          "confirmation_focus",
        ] as const,
      },
    ].map((item) => ({ ...item, assertionIds: [...item.assertionIds] })),
    outcomeOracle: "appointment_record_matches_selected_valid_slot",
    humanChecks: [
      "Actual screen-reader error and selection comprehension",
      "Unassisted completion by a consenting participant",
      "Specialist review of semantics and task language",
    ],
    supportedCombinations: [
      "Chromium · keyboard · authored synthetic React fixtures",
    ],
  };
  return { ...contract, digest: digest(JSON.stringify(contract)) };
}

export async function getOriginalSource(fixtureId: string): Promise<string> {
  const file = getFixture(fixtureId).sourceFile;
  return readFile(
    fileURLToPath(new URL(`../fixtures/original/${file}`, import.meta.url)),
    "utf8",
  );
}
export async function getReferenceSource(fixtureId: string): Promise<string> {
  const file = getFixture(fixtureId).sourceFile;
  return readFile(
    fileURLToPath(new URL(`../fixtures/reference/${file}`, import.meta.url)),
    "utf8",
  );
}
