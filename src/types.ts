type CursorPosition = {
  line: number;
  ch: number;
};

export type EphemeralState = {
  cursor: {
    from: CursorPosition;
    to: CursorPosition;

    scroll: number;
  };
};
