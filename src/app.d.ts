import type { Session } from '#lib/server/session.js';
import type { Preferences } from '#lib/types/preferences.js';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      session: Session | null;
      preferences: Preferences;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
