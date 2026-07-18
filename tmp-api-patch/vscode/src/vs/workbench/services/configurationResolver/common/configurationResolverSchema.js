
import { localize } from '../../../../nls.js';

const idDescription = ( localize(
    17451,
    "The input's id is used to associate an input with a variable of the form ${input:id}."
));
const typeDescription = ( localize(17452, "The type of user input prompt to use."));
const descriptionDescription = ( localize(17453, "The description is shown when the user is prompted for input."));
const defaultDescription = ( localize(17454, "The default value for the input."));
const inputsSchema = {
    definitions: {
        inputs: {
            type: "array",
            description: ( localize(
                17455,
                "User inputs. Used for defining user input prompts, such as free string input or a choice from several options."
            )),
            items: {
                oneOf: [{
                    type: "object",
                    required: ["id", "type", "description"],
                    additionalProperties: false,
                    properties: {
                        id: {
                            type: "string",
                            description: idDescription
                        },
                        type: {
                            type: "string",
                            description: typeDescription,
                            enum: ["promptString"],
                            enumDescriptions: [( localize(
                                17456,
                                "The 'promptString' type opens an input box to ask the user for input."
                            ))]
                        },
                        description: {
                            type: "string",
                            description: descriptionDescription
                        },
                        default: {
                            type: "string",
                            description: defaultDescription
                        },
                        password: {
                            type: "boolean",
                            description: ( localize(
                                17457,
                                "Controls if a password input is shown. Password input hides the typed text."
                            ))
                        }
                    }
                }, {
                    type: "object",
                    required: ["id", "type", "description", "options"],
                    additionalProperties: false,
                    properties: {
                        id: {
                            type: "string",
                            description: idDescription
                        },
                        type: {
                            type: "string",
                            description: typeDescription,
                            enum: ["pickString"],
                            enumDescriptions: [( localize(17458, "The 'pickString' type shows a selection list."))]
                        },
                        description: {
                            type: "string",
                            description: descriptionDescription
                        },
                        default: {
                            type: "string",
                            description: defaultDescription
                        },
                        options: {
                            type: "array",
                            description: ( localize(17459, "An array of strings that defines the options for a quick pick.")),
                            items: {
                                oneOf: [{
                                    type: "string"
                                }, {
                                    type: "object",
                                    required: ["value"],
                                    additionalProperties: false,
                                    properties: {
                                        label: {
                                            type: "string",
                                            description: ( localize(17460, "Label for the option."))
                                        },
                                        value: {
                                            type: "string",
                                            description: ( localize(17461, "Value for the option."))
                                        }
                                    }
                                }]
                            }
                        }
                    }
                }, {
                    type: "object",
                    required: ["id", "type", "command"],
                    additionalProperties: false,
                    properties: {
                        id: {
                            type: "string",
                            description: idDescription
                        },
                        type: {
                            type: "string",
                            description: typeDescription,
                            enum: ["command"],
                            enumDescriptions: [( localize(17462, "The 'command' type executes a command."))]
                        },
                        command: {
                            type: "string",
                            description: ( localize(17463, "The command to execute for this input variable."))
                        },
                        args: {
                            oneOf: [{
                                type: "object",
                                description: ( localize(17464, "Optional arguments passed to the command."))
                            }, {
                                type: "array",
                                description: ( localize(17464, "Optional arguments passed to the command."))
                            }, {
                                type: "string",
                                description: ( localize(17464, "Optional arguments passed to the command."))
                            }]
                        }
                    }
                }]
            }
        }
    }
};

export { inputsSchema };
