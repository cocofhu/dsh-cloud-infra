/** Browser stand-in for the one export the view compiler uses from @deepseek-ai/dsh-tools. */
export class ToolArgsError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('\n'))
    this.name = 'ToolArgsError'
  }
}
