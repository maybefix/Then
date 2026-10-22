//! AI conversations (docs/AI_CONVERSATION_IMPLEMENTATION_PLAN.md).
//!
//! Every send is rebuilt from Then's own record of the conversation: the
//! earlier turns, the new input and the instruction text. A connector turns
//! that into one provider request and the reply into an `Answer`; state,
//! stopping, saving and display stay out of the connectors.
//!
//! `fixture` answers without a network or a key, so the rest can be built and
//! tested before any real provider is wired in.

// Commands come with the conversation pane (step 2 of the plan).
#![cfg_attr(not(test), allow(dead_code))]

pub mod conversation;
pub mod fixture;
pub mod prompt;
