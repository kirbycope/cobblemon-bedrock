// A stand-in for @minecraft/server-ui (tools/battle_test): forms are built and never shown. An action form's show is
// recorded in shown (its title and the player), so a test can tell which screen opened for whom.
import { anything } from "./stub_server.mjs";

export const shown = [];
export class ActionFormData {
    constructor() { this._title = ""; }
    title(t) { this._title = t; return this; }
    body() { return this; }
    button() { return this; }
    header() { return this; }
    label() { return this; }
    divider() { return this; }
    show(player) { shown.push({ title: this._title, player }); return new Promise(() => { }); }
}
export const MessageFormData = anything(), ModalFormData = anything();
export const FormCancelationReason = anything(), uiManager = anything();
