import { Option } from "effect";

/**
 * Items posted while no sink is attached wait, up to `capacity`, and go to
 * the next attached sink in posting order; later posts go straight to it.
 * Items over capacity are dropped. A sink that throws loses that item and
 * nothing else.
 */
export type Outbox<Item> = {
  /** Attaches the sink and delivers the held items. Returns the detach function. */
  readonly attach: (sink: (item: Item) => void) => () => void;
  /** Drops the items still waiting for a sink. */
  readonly discard: () => void;
  readonly post: (item: Item) => void;
};

export const createOutbox = <Item>({
  capacity,
}: {
  readonly capacity: number;
}): Outbox<Item> => {
  const pending: Item[] = [];
  let attachedSink: ((item: Item) => void) | undefined;

  const deliver = Option.liftThrowable(
    (sink: (item: Item) => void, item: Item) => sink(item)
  );

  return {
    attach: (sink) => {
      attachedSink = sink;
      for (const item of pending.splice(0)) deliver(sink, item);

      return () => {
        if (attachedSink === sink) attachedSink = undefined;
      };
    },
    discard: () => {
      pending.length = 0;
    },
    post: (item) => {
      if (attachedSink !== undefined) {
        deliver(attachedSink, item);
      } else if (pending.length < capacity) {
        pending.push(item);
      }
    },
  };
};
