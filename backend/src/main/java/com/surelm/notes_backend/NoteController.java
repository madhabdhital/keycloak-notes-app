package com.surelm.notes_backend;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class NoteController {

    private final NoteRepository repo;

    public NoteController(NoteRepository repo) {
        this.repo = repo;
    }

    @GetMapping("/public/hello")
    public Map<String, String> hello() {
        return Map.of("message", "Public endpoint, no token needed");
    }

    @GetMapping("/me")
    public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt, Authentication auth) {
        List<String> roles = auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority).toList();
        return Map.of(
                "username", String.valueOf(jwt.getClaimAsString("preferred_username")),
                "userId", jwt.getSubject(),
                "roles", roles);
    }

    @GetMapping("/notes")
    public List<Note> myNotes(@AuthenticationPrincipal Jwt jwt) {
        return repo.findByOwnerId(jwt.getSubject());
    }

    @PostMapping("/notes")
    public Note create(@AuthenticationPrincipal Jwt jwt, @RequestBody Map<String, String> body) {
        String content = body.get("content");
        if (content == null || content.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Content is required");
        }
        Note note = new Note();
        note.setContent(content);
        note.setOwnerId(jwt.getSubject());
        note.setOwnerUsername(jwt.getClaimAsString("preferred_username"));
        return repo.save(note);
    }

    @DeleteMapping("/notes/{id}")
    public void deleteOwn(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        Note note = repo.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!note.getOwnerId().equals(jwt.getSubject())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not your note");
        }
        repo.delete(note);
    }

    @GetMapping("/admin/notes")
    public List<Note> allNotes() {
        return repo.findAll();
    }

    @DeleteMapping("/admin/notes/{id}")
    public void adminDelete(@PathVariable Long id) {
        if (!repo.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        repo.deleteById(id);
    }
}