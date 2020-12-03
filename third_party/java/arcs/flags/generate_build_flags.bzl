"""Rules for generating the BuildFlags class."""

load("//third_party/java/arcs/build_defs:build_defs.bzl", "arcs_kt_library")
load(":arcs_build_flag.bzl", "apply_flag_overrides")
load(":flags.bzl", "ARCS_BUILD_FLAGS")

_DEFAULT_CLASS_NAME = "BuildFlags"

_DEFAULT_FILE_NAME = "BuildFlags.kt"

# Template for real release builds.
_TEMPLATE = """
package arcs.flags;

/**
 * Generated Arcs build flags.
 *
 * {DESCRIPTION}
 */
object {CLASS} {{
{FIELDS}
}}
"""

# Template where flags are not final, and includes a reset() method.
_DEV_MODE_TEMPLATE = """
package arcs.flags

/**
 * Generated Arcs build flags for unit tests.
 *
 * Use [BuildFlagsRule] to reset flags between test runs.
 */
object {CLASS} {{
{FIELDS}

  /** Resets flags to their original values. */
  fun reset() {{
{FIELD_RESETS}
    validate()
  }}

  /** Checks that if [flagName] is enabled, then [requiredFlagName] is also. */
  private fun checkRequiredFlag(
    flagName: String,
    requiredFlagName: String,
    flagEnabled: Boolean,
    requiredFlagEnabled: Boolean
  ) {{
    check(!flagEnabled || requiredFlagEnabled) {{
      "Flag '$flagName' requires flag '$requiredFlagName' to be enabled."
    }}
  }}

  /** Checks all flags are set to valid values. */
  private fun validate() {{
{FIELD_VALIDATIONS}
  }}
}}
"""

def generate_build_flags(
        name,
        flags = ARCS_BUILD_FLAGS,
        flag_overrides = {},
        class_name = _DEFAULT_CLASS_NAME,
        dev_mode = False,
        testonly = False,
        visibility = None):
    """Generates a BuildFlags class using the status of each flag.

    Args:
      name: Label for the build target.
      flags: Optional list of arcs_build_flag definitions (see arcs_build_flag.bzl). Defaults to
          ARCS_BUILD_FLAGS. Only override for testing purposes.
      flag_overrides: Optional dict mapping from flag name to value (boolean). Overrides the default
          value from the flag definition.
      class_name: Optional name for the generated class. Default is BuildFlags.
      testonly: Optional boolean to make the target test only.
      dev_mode: Optional boolean indicating whether the generated class is for
          development purposes (e.g. unit tests).
      visibility: Visibility of the generated kt_library target.
    """
    flag_values = apply_flag_overrides(flags, flag_overrides, dev_mode)

    # Convert boolean flag values to strings.
    flag_value_strings = {flag_name: str(value) for flag_name, value in flag_values.items()}

    # Collect list of required flags.
    required_flags = {flag.name: flag.required_flags for flag in flags}

    # Nest the output file inside the correct directory structure for its
    # package, and nest that inside a new folder for this build target to avoid
    # collisions with other generated files.
    out = "{name}/arcs/flags/{class_name}.kt".format(
        name = name,
        class_name = class_name,
    )

    # Generate .kt src file.
    src_name = name + "_src"
    _generate_build_flags(
        name = src_name,
        class_name = class_name,
        desc = "Defaults for development. Flags are all set to their default values.",
        flags = flag_value_strings,
        required_flags = required_flags,
        out = out,
        dev_mode = dev_mode,
        testonly = testonly,
        visibility = ["//visibility:private"],
    )

    # kt_library wrapper
    arcs_kt_library(
        name = name,
        srcs = [":" + src_name],
        testonly = testonly,
        visibility = visibility,
    )

def _generate_prod_mode_file(class_name, desc, flag_list):
    field_def_template = "  val {NAME} = {VALUE}"

    fields = []
    for name, value in flag_list:
        fields.append(field_def_template.format(NAME = name, VALUE = value))

    return _TEMPLATE.format(
        CLASS = class_name,
        DESCRIPTION = desc,
        FIELDS = "\n".join(fields),
    )

def _generate_dev_mode_file(class_name, desc, flag_list, required_flags):
    field_def_template = """
  private var _{NAME} = {VALUE}

  var {NAME}: Boolean
    get() = _{NAME}
    set(value) {{
      _{NAME} = value
      validate()
    }}"""
    field_reset_template = "    _{NAME} = {VALUE}"
    field_validation_template = (
        "    checkRequiredFlag(\"{FLAG}\", \"{REQUIRED_FLAG}\", {FLAG}, {REQUIRED_FLAG})"
    )

    fields = []
    field_resets = []
    field_validations = []
    for name, value in flag_list:
        fields.append(field_def_template.format(NAME = name, VALUE = value))
        field_resets.append(field_reset_template.format(NAME = name, VALUE = value))

        for required_flag in required_flags.get(name.lower(), []):
            field_validations.append(field_validation_template.format(
                FLAG = name,
                REQUIRED_FLAG = required_flag.upper(),
            ))

    return _DEV_MODE_TEMPLATE.format(
        CLASS = class_name,
        DESCRIPTION = desc,
        FIELDS = "\n".join(fields),
        FIELD_RESETS = "\n".join(field_resets),
        FIELD_VALIDATIONS = "\n".join(field_validations),
    )

def _generate_build_flags_impl(ctx):
    # List of (name, value) pairs. Flag name in uppercase, flag value (true/false) in lowercase.
    flag_list = [(name.upper(), value.lower()) for name, value in sorted(ctx.attr.flags.items())]

    if ctx.attr.dev_mode:
        content = _generate_dev_mode_file(
            class_name = ctx.attr.class_name,
            desc = ctx.attr.desc,
            flag_list = flag_list,
            required_flags = ctx.attr.required_flags,
        )
    else:
        content = _generate_prod_mode_file(ctx.attr.class_name, ctx.attr.desc, flag_list)

    ctx.actions.write(
        output = ctx.outputs.out,
        content = content,
    )

_generate_build_flags = rule(
    implementation = _generate_build_flags_impl,
    attrs = {
        "class_name": attr.string(
            mandatory = True,
            doc = "Name of the class to generate.",
        ),
        "desc": attr.string(
            doc = "Descriptive comment to add to the generated file.",
        ),
        "flags": attr.string_dict(
            mandatory = True,
            doc = "Dict of flags mapping from flag name to value.",
        ),
        "required_flags": attr.string_list_dict(
            mandatory = True,
            doc = "Dict of required flag relationships, mapping from flag name to a list of " +
                  "names of required flags.",
        ),
        "dev_mode": attr.bool(
            doc = "If true, flags are non-final and can be reset.",
        ),
        "out": attr.output(
            mandatory = True,
            doc = "Output .kt file created by this rule.",
        ),
    },
)
