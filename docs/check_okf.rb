#!/usr/bin/env ruby
# Validate this repo's OKF bundle, provenance paths, and local documentation links.
require 'date'
require 'pathname'
require 'yaml'

root = Pathname.new(__dir__)
errors = []
files = root.glob('**/*.md').sort
files.each do |file|
  text = file.read
  relative = file.relative_path_from(root).to_s
  if file.basename.to_s == 'index.md'
    errors << "#{relative}: index must start with an H1" unless text.match?(/\A# .+/)
    errors << "#{relative}: index must not have frontmatter" if text.start_with?("---\n")
  elsif file.basename.to_s == 'log.md'
    errors << "#{relative}: log must start with an H1" unless text.match?(/\A# .+/)
    text.scan(/^## (.+)$/).flatten.each do |heading|
      errors << "#{relative}: log date is not ISO format: #{heading}" unless heading.match?(/\A\d{4}-\d{2}-\d{2}\z/)
    end
  else
    match = text.match(/\A---\n(.*?)\n---\n/m)
    if match.nil?
      errors << "#{relative}: missing YAML frontmatter"
    else
      begin
        metadata = YAML.safe_load(match[1], [Date, Time], [], false)
        errors << "#{relative}: frontmatter needs nonempty type" unless metadata.is_a?(Hash) && metadata['type'].is_a?(String) && !metadata['type'].strip.empty?
        if metadata.is_a?(Hash)
          status = metadata['status']
          errors << "#{relative}: invalid OKF lifecycle status #{status.inspect}" if status && !%w[draft stable deprecated].include?(status)
          sources = metadata['sources']
          if sources && !sources.is_a?(Array)
            errors << "#{relative}: sources must be a list"
          elsif sources
            sources.each_with_index do |source, index|
              resource = source.is_a?(Hash) && source['resource']
              unless resource.is_a?(String) && !resource.strip.empty?
                errors << "#{relative}: sources[#{index}] needs a resource"
                next
              end
              next if resource.match?(/\A[a-z][a-z0-9+.-]*:/i)
              path = resource.start_with?('/') ? root + resource.delete_prefix('/') : file.dirname + resource
              errors << "#{relative}: broken source path #{resource}" unless path.exist?
            end
          end
        end
      rescue Psych::Exception => error
        errors << "#{relative}: invalid YAML: #{error.message}"
      end
    end
  end

  text.scan(/\]\(([^)]+)\)/).flatten.each do |link|
    next if link.match?(/\A(?:https?:|mailto:|data:|#|\/|<)/)
    target = link.split('#', 2).first
    next if target.nil? || target.empty?
    errors << "#{relative}: broken local link #{link}" unless (file.dirname + target).exist?
  end
end

abort(errors.join("\n")) unless errors.empty?
puts "OKF docs: #{files.size} Markdown files, lifecycle status, source paths, indexes, log, and local links valid"
