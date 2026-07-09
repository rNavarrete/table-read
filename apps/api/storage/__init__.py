"""Persistence layer (data contract §3): DB setup, ORM models, seed logic.

`storage/snapshots.py` (the mutation-transaction helper CLAUDE.md's hard
rule 4 refers to) lands in T1.1 alongside real mutation endpoints; T0.3
only needs the six tables to exist and the fixture loaded into them.
"""
