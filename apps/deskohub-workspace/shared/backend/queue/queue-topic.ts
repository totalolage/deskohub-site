import { decodeStandardSchema } from "@deskohub/standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Duration, Effect } from "effect";
import { defineQueueConsumer, type QueueRedelivery } from "./queue-consumer";
import {
  type QueueMessageSendError,
  type QueuePublication,
  QueuePublisher,
  type QueuePublishOutcome,
} from "./queue-publisher";

/** What one publish to a topic sends. */
export type QueueTopicMessage<Message> = {
  readonly message: Message;
  /** Stable across retries, so a repeated publish is a no-op. */
  readonly key: string;
  /** Holds the first delivery back by this long. */
  readonly delay?: Duration.Duration;
  /** Replaces the topic's retention for this message. */
  readonly retention?: Duration.Duration;
};

/**
 * One Vercel Queue topic: the messages its publishers send and its consumer
 * decodes. Its route still needs a literal trigger in `vercel.json`.
 */
export interface QueueTopic<
  Topic extends string,
  Input,
  Message extends StandardSchemaV1,
> {
  readonly topic: Topic;
  /** Decodes the topic's messages. */
  readonly message: StandardSchemaV1<
    StandardSchemaV1.InferInput<Message>,
    StandardSchemaV1.InferOutput<Message>
  >;
  /** The message, key, and options a publish of `input` sends. */
  readonly publication: (
    input: Input
  ) => QueuePublication<StandardSchemaV1.InferInput<Message>>;
  /** Publishes `input`; a message already published is `duplicate`. */
  readonly publish: (
    input: Input
  ) => Effect.Effect<
    QueuePublishOutcome,
    QueueMessageSendError,
    QueuePublisher
  >;
  /**
   * Defines the topic's queue route handler. A message that doesn't decode is
   * logged and acknowledged; `redelivery` classifies the handler's failures.
   */
  readonly consume: <E>(
    operation: string,
    handle: (
      message: StandardSchemaV1.InferOutput<Message>
    ) => Effect.Effect<unknown, E, never>,
    redelivery?: (error: E) => QueueRedelivery
  ) => ReturnType<typeof defineQueueConsumer>;
}

export const defineQueueTopic = <
  const Topic extends string,
  Input,
  Message extends StandardSchemaV1,
>(definition: {
  readonly topic: Topic;
  /** Names the topic's messages in logs, such as "Paid fulfillment". */
  readonly label: string;
  readonly message: Message;
  readonly publish: (
    input: Input
  ) => QueueTopicMessage<StandardSchemaV1.InferInput<Message>>;
  /** Defaults to the queue's retention. */
  readonly retention?: Duration.Duration;
}): QueueTopic<Topic, Input, Message> => {
  const publication = (input: Input) => {
    const {
      message,
      key,
      delay,
      retention = definition.retention,
    } = definition.publish(input);
    return {
      topic: definition.topic,
      message,
      // The SDK sends only the options that are defined.
      options: {
        delaySeconds: toSeconds(delay),
        retentionSeconds: toSeconds(retention),
        idempotencyKey: key,
      },
    };
  };

  return {
    topic: definition.topic,
    message: definition.message,
    publication,
    publish: (input) =>
      Effect.flatMap(QueuePublisher, (publisher) =>
        publisher.publish(publication(input))
      ),
    consume: (operation, handle, redelivery) =>
      defineQueueConsumer(
        operation,
        (message) => {
          const decoded = decodeStandardSchema(definition.message, message);
          return decoded === undefined
            ? Effect.logWarning(
                `${definition.label} queue message ignored: invalid payload`
              ).pipe(Effect.as("ignored" as const))
            : handle(decoded);
        },
        redelivery
      ),
  };
};

const toSeconds = (duration: Duration.Duration | undefined) =>
  duration === undefined ? undefined : Duration.toSeconds(duration);
