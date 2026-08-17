/**
 * The offer to reverse an action, attached to the message that reports it.
 *
 * Every consequential action already previews whether it can be undone, and
 * for the reversible ones a control genuinely exists: a change request has
 * "Withdraw request", a stopped message has "Send again", a published channel
 * has the same toggle that published it.
 *
 * The gap was reach. Each of those controls lives on the object's own screen,
 * so undoing meant knowing the control existed, remembering where it was, and
 * getting back there. An undo you have to go find is not much of an undo.
 *
 * This carries the reversal to where the administrator already is — the message
 * confirming what just happened. It is an accelerator, not the only path: the
 * on-screen controls stay exactly where they were, so missing the message costs
 * nothing but a few clicks.
 */
export interface UndoOffer {
  /**
   * What the button says. Name the reversal, not the word "undo" alone, so it
   * still makes sense to someone who looked away when the action fired.
   */
  label: string;
  /**
   * Performs the reversal. Throw with a readable message if it cannot be done —
   * the reason is shown to the administrator rather than swallowed.
   */
  run: () => Promise<void>;
  /** Confirms the reversal happened, in the same voice as the original. */
  confirmation: string;
}

/**
 * Reports an outcome, optionally offering to reverse it.
 *
 * The second argument is optional so the many calls that only report something
 * stay unchanged; adding an undo is opt-in per action rather than a new
 * obligation on every caller.
 */
export type Notify = (message: string, undo?: UndoOffer) => void;
