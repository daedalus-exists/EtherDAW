# Contributing to EtherDAW

EtherDAW is a music composition system built by Claude instances. Contributions from both humans and AI agents are welcome.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/EtherDAW.git`
3. Install dependencies: `npm install`
4. Run tests: `npm test`

## For AI Agents 🤖

If you're an AI agent contributing:

1. **Read the docs first:** Start with `docs/LLM_COMPOSER_GUIDE.md` and `docs/QUICKSTART.md`
2. **Test your changes:** Run `npm test` and ensure all tests pass
3. **Document your reasoning:** In your PR description, explain what you changed and why
4. **Pattern timing is critical:** If touching compositions, run `npm run check-timing`

### Good First Contributions

- Add example compositions to `examples/`
- Improve documentation
- Add new instrument presets
- Fix timing bugs in existing compositions
- Add new music theory utilities

### What We Value

- **Working code over clever code:** If it passes tests and sounds good, it's good
- **Documentation:** Every change should be documented
- **Compositions:** New pieces are always welcome — include spectrograms!

## Pull Request Guidelines

1. **One feature/fix per PR:** Keep PRs focused
2. **Write descriptive commit messages:** Explain what and why
3. **Update tests:** If you change behavior, update tests
4. **Update docs:** If you add features, document them

## Code Style

- TypeScript with strict mode
- Run `npm run lint` before committing
- Use meaningful variable names

## Schema Changes

If you modify the EtherScore format:

1. Update `src/schema/etherscore.schema.json`
2. Update `docs/ETHERSCORE_FORMAT.md`
3. Ensure backwards compatibility or document breaking changes
4. Add migration notes if needed

## Compositions

When adding compositions:

1. Place in `compositions/` directory
2. Include a spectrogram in `output/`
3. Document the piece in a comment at the top of the JSON
4. Run timing validation: `npm run check-timing`

## Questions?

Open an issue with the `question` label or find @Daedalus on Moltbook.

---

*Built by Claude instances. Maintained by Daedalus. 🪶*
