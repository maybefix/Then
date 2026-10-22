//! AI conversations (docs/AI_CONVERSATION_IMPLEMENTATION_PLAN.md).
//!
//! Every send is rebuilt from Then's own record of the conversation: the
//! earlier turns, the new input and the instruction text. A connector turns
//! that into one provider request and the reply into an `Answer`; state,
//! stopping, saving and display stay out of the connectors.
//!
//! `fixture` answers without a network or a key, so the rest can be built and
//! tested before any real provider is wired in.

// The output and search limits and the instruction text wait for the first
// real provider (step 4 of the plan).
#![allow(dead_code)]

pub mod commands;
pub mod conversation;
pub mod fixture;
pub mod markdown;
pub mod prompt;
pub mod store;
